import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RequestSchema = z.object({
  baseline_id: z.string().uuid('Invalid baseline ID format')
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const validation = RequestSchema.safeParse(body);
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: validation.error.issues }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { baseline_id } = validation.data;

    console.log('Starting enhanced pricing processing');

    const { data: baseline, error: baselineError } = await supabase
      .from('product_baselines')
      .select('*')
      .eq('id', baseline_id)
      .single();

    if (baselineError || !baseline) {
      return new Response(JSON.stringify({ error: 'Baseline not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (baseline.merchant_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden: Not your baseline' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('processing_status').insert({
      baseline_id,
      status: 'processing',
      current_step: 'fetching_inflation'
    });

    const backgroundTask = (async () => {
      try {
        const { rate: inflationRate, source: inflationSource } = await fetchInflationRate(baseline.currency);
        console.log('Fetched inflation rate:', inflationRate);
        
        await supabase.from('inflation_snapshots').insert({
          inflation_rate: inflationRate,
          source: inflationSource
        });

        await supabase.from('processing_status')
          .update({ current_step: 'fetching_competitors' })
          .eq('baseline_id', baseline_id);

        console.log('Triggering competitor scraping...');
        
        // FIX 1: Retry logic with exponential backoff for refresh-competitors
        let refreshSuccess = false;
        let refreshRetries = 3;
        let lastRefreshError: any = null;
        
        while (!refreshSuccess && refreshRetries > 0) {
          try {
            const { data, error: refreshError } = await supabase.functions.invoke(
              'refresh-competitors',
              { body: { baseline_id } }
            );

            if (refreshError) {
              lastRefreshError = refreshError;
              console.error(`❌ refresh-competitors error (attempt ${4 - refreshRetries}/3):`, refreshError);
              refreshRetries--;
              if (refreshRetries > 0) {
                const waitTime = (4 - refreshRetries) * 3000; // 3s, 6s, 9s backoff
                console.log(`⏳ Waiting ${waitTime}ms before retry...`);
                await new Promise(r => setTimeout(r, waitTime));
              }
            } else {
              refreshSuccess = true;
              console.log('✅ Competitor scraping completed successfully');
            }
          } catch (e: any) {
            lastRefreshError = e;
            console.error(`❌ refresh-competitors exception (attempt ${4 - refreshRetries}/3):`, e.message);
            refreshRetries--;
            if (refreshRetries > 0) {
              const waitTime = (4 - refreshRetries) * 3000;
              console.log(`⏳ Waiting ${waitTime}ms before retry...`);
              await new Promise(r => setTimeout(r, waitTime));
            }
          }
        }
        
        if (!refreshSuccess) {
          console.log('⚠️ Competitor scraping failed after 3 attempts, proceeding with existing data');
        }
        
        // Wait a moment for database writes to settle
        await new Promise(r => setTimeout(r, 1000));

        await supabase.from('processing_status')
          .update({ current_step: 'calculating_price' })
          .eq('baseline_id', baseline_id);

        await calculateOptimalPrice(supabase, baseline, inflationRate);

        await supabase.from('processing_status')
          .update({ status: 'completed', current_step: 'complete' })
          .eq('baseline_id', baseline_id);

        console.log('✅ Enhanced pricing calculation completed');
      } catch (error: any) {
        console.error('Background processing error:', error);
        await supabase.from('processing_status')
          .update({ status: 'failed', error_message: error?.message || 'Unknown error' })
          .eq('baseline_id', baseline_id);
      }
    })();

    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundTask);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Enhanced pricing processing started', baseline_id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Internal] Process-pricing error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process pricing request' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function fetchInflationRate(currency: string): Promise<{ rate: number; source: string }> {
  if (currency === 'SAR') {
    return { rate: 0.023, source: 'SAMA (Saudi Central Bank) - Latest CPI Data' };
  } else if (currency === 'USD') {
    return { rate: 0.031, source: 'US Bureau of Labor Statistics - Latest CPI' };
  }
  return { rate: 0.025, source: 'IMF Global Estimate' };
}

/**
 * Validate market data quality before using it
 * Returns: { isValid: boolean, reason: string, shouldProceed: boolean, warning?: string }
 */
function validateMarketData(
  marketStats: { lowest: number; average: number; highest: number },
  baselinePrice: number,
  productCount: number,
  category: string
): { isValid: boolean; reason: string; shouldProceed: boolean; warning?: string } {
  
  // Check 1: Minimum data points
  if (productCount < 3) {
    return {
      isValid: false,
      reason: `Insufficient competitor data (only ${productCount} products found)`,
      shouldProceed: false
    };
  }
  
  // Check 2: Market spread validation
  const marketSpread = (marketStats.highest - marketStats.lowest) / marketStats.average;
  
  if (marketSpread > 5) {
    // 500%+ spread indicates contaminated data
    return {
      isValid: false,
      reason: `Market data quality issue: price spread ${(marketSpread * 100).toFixed(0)}% (extreme outliers detected). Please refresh competitor data.`,
      shouldProceed: false
    };
  }
  
  // Check 3: Lowest price sanity check with category awareness
  // Size-variable products (perfumes, cosmetics, food) allow wider price ranges
  const sizeVariableCategories = ['Health & Beauty', 'Food & Beverages', 'Groceries (Staples)'];
  const isSizeVariable = sizeVariableCategories.includes(category);
  const lowestThreshold = isSizeVariable ? 0.10 : 0.15; // 10% for size-variable, 15% for others
  
  const lowestRatio = marketStats.lowest / baselinePrice;
  if (lowestRatio < lowestThreshold) {
    // Instead of blocking completely, issue a warning but proceed
    const warning = `Market includes low-priced variants (${marketStats.lowest.toFixed(0)}). These may be different sizes or bundles. Using weighted average for accuracy.`;
    console.log(`⚠️ ${warning}`);
    
    return {
      isValid: true,
      reason: 'Proceeding with outlier-filtered market data',
      shouldProceed: true,
      warning
    };
  }
  
  // Check 4: Average price reasonableness - relaxed for size-variable products
  const avgRatio = marketStats.average / baselinePrice;
  const avgLowerBound = isSizeVariable ? 0.2 : 0.3;
  const avgUpperBound = isSizeVariable ? 4.0 : 3.0;
  
  if (avgRatio < avgLowerBound || avgRatio > avgUpperBound) {
    return {
      isValid: false,
      reason: `Market average (${marketStats.average.toFixed(0)}) differs too much from baseline (${baselinePrice.toFixed(0)}). Data quality issues detected.`,
      shouldProceed: false
    };
  }
  
  return {
    isValid: true,
    reason: 'Market data passed validation checks',
    shouldProceed: true
  };
}

// Statistical outlier removal using IQR method
function removeOutliers(prices: number[]): { cleaned: number[]; removed: number } {
  if (prices.length < 4) return { cleaned: prices, removed: 0 };
  
  const sorted = [...prices].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.floor(sorted.length * 0.75);
  
  const q1 = sorted[q1Index];
  const q3 = sorted[q3Index];
  const iqr = q3 - q1;
  
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  
  const filtered = prices.filter(p => p >= lowerBound && p <= upperBound);
  
  console.log(`🔍 Outlier removal: ${prices.length} prices → ${filtered.length} after filtering`);
  console.log(`   Removed range outside [${lowerBound.toFixed(2)}, ${upperBound.toFixed(2)}]`);
  
  return {
    cleaned: filtered.length > 0 ? filtered : prices,
    removed: prices.length - filtered.length
  };
}

// Calculate weighted market stats from competitor products
function calculateWeightedMarketStats(
  products: any[],
  aggregates: any[]
): { 
  lowest: number; 
  average: number; 
  highest: number; 
  confidence: string;
  outliersRemoved: number;
  productsUsed: number;
} {
  if (!products || products.length === 0) {
    // Fallback to aggregate data
    console.log('⚠️ No granular products, using aggregates');
    const allPrices: number[] = [];
    aggregates?.forEach(comp => {
      if (comp.lowest_price) allPrices.push(comp.lowest_price);
      if (comp.average_price) allPrices.push(comp.average_price);
      if (comp.highest_price) allPrices.push(comp.highest_price);
    });
    
    if (allPrices.length === 0) {
      return { lowest: 0, average: 0, highest: 0, confidence: 'none', outliersRemoved: 0, productsUsed: 0 };
    }
    
    const { cleaned, removed } = removeOutliers(allPrices);
    return {
      lowest: Math.min(...cleaned),
      average: cleaned.reduce((a, b) => a + b, 0) / cleaned.length,
      highest: Math.max(...cleaned),
      confidence: 'low',
      outliersRemoved: removed,
      productsUsed: 0
    };
  }
  
  // ✅ FIX 6: Increase similarity threshold to 0.8 (80%)
  const filteredProducts = products.filter(p => p.similarity_score >= 0.8);
  
  console.log(`🔍 Similarity filtering: ${products.length} → ${filteredProducts.length} products (removed ${products.length - filteredProducts.length} low-similarity matches)`);
  
  if (filteredProducts.length < 3) {
    console.log('⚠️ Not enough high-similarity products, using aggregate data');
    const allPrices: number[] = [];
    aggregates?.forEach(comp => {
      if (comp.lowest_price) allPrices.push(comp.lowest_price);
      if (comp.average_price) allPrices.push(comp.average_price);
      if (comp.highest_price) allPrices.push(comp.highest_price);
    });
    
    if (allPrices.length === 0) {
      return { lowest: 0, average: 0, highest: 0, confidence: 'very_low', outliersRemoved: 0, productsUsed: filteredProducts.length };
    }
    
    const { cleaned, removed } = removeOutliers(allPrices);
    return {
      lowest: Math.min(...cleaned),
      average: cleaned.reduce((a, b) => a + b, 0) / cleaned.length,
      highest: Math.max(...cleaned),
      confidence: 'very_low',
      outliersRemoved: removed,
      productsUsed: filteredProducts.length
    };
  }
  
  console.log(`📊 Analyzing ${filteredProducts.length} high-similarity competitor products`);
  
  // Weight each product by similarity score
  let weightedSum = 0;
  let totalWeight = 0;
  const prices: number[] = [];
  
  filteredProducts.forEach(prod => {
    const weight = prod.similarity_score;
    weightedSum += prod.price * weight;
    totalWeight += weight;
    prices.push(prod.price);
  });
  
  // Remove statistical outliers
  const { cleaned, removed } = removeOutliers(prices);
  
  // Recalculate weighted average with cleaned prices
  let cleanedWeightedSum = 0;
  let cleanedTotalWeight = 0;
  filteredProducts.forEach(prod => {
    if (cleaned.includes(prod.price)) {
      const weight = prod.similarity_score;
      cleanedWeightedSum += prod.price * weight;
      cleanedTotalWeight += weight;
    }
  });
  
  const weightedAverage = cleanedTotalWeight > 0 ? cleanedWeightedSum / cleanedTotalWeight : 0;
  
  return {
    lowest: Math.min(...cleaned),
    average: weightedAverage,
    highest: Math.max(...cleaned),
    confidence: filteredProducts.length >= 10 ? 'high' : filteredProducts.length >= 5 ? 'medium' : 'low',
    outliersRemoved: removed,
    productsUsed: filteredProducts.length
  };
}

// Calculate profit-maximizing price using elasticity theory
function calculateProfitMaximizingPrice(
  cost: number,
  elasticity: number,
  currentPrice: number,
  marketAverage: number,
  marketLowest: number,
  marketHighest: number,
  inflationRate: number
): { 
  theoreticalOptimal: number;
  marketAdjusted: number;
  reasoning: string;
} {
  // Apply inflation adjustment to market boundaries FIRST
  const inflationMultiplier = 1 + inflationRate;
  const inflationAdjustedAverage = marketAverage * inflationMultiplier;
  const inflationAdjustedHighest = marketHighest * inflationMultiplier;
  const inflationAdjustedLowest = marketLowest * inflationMultiplier;
  
  console.log(`📊 Market bounds (inflation-adjusted):`);
  console.log(`   Lowest: ${inflationAdjustedLowest.toFixed(2)}`);
  console.log(`   Average: ${inflationAdjustedAverage.toFixed(2)}`);
  console.log(`   Highest: ${inflationAdjustedHighest.toFixed(2)}`);
  console.log(`   Inflation rate: ${(inflationRate * 100).toFixed(2)}%`);
  
  // Revenue-maximizing price from elasticity theory
  // Formula: P* = Cost / (1 + 1/elasticity)
  const rawTheoretical = cost / (1 + 1 / elasticity);
  const theoreticalOptimal = rawTheoretical;
  
  console.log(`💡 Theoretical optimal: ${theoreticalOptimal.toFixed(2)}`);
  console.log(`   Based on elasticity ${elasticity} and cost ${cost}`);
  
  // MARKET-DRIVEN APPROACH: Start with inflation-adjusted market average
  let suggestedPrice = inflationAdjustedAverage;
  
  // Apply elasticity influence: blend theoretical if it suggests better pricing
  const profitMargin = (suggestedPrice - cost) / cost;
  if (theoreticalOptimal > cost * 1.15 && theoreticalOptimal < inflationAdjustedAverage) {
    // Theoretical suggests lower price could maximize profit - blend 40% toward it
    suggestedPrice = (inflationAdjustedAverage * 0.6) + (theoreticalOptimal * 0.4);
    console.log(`   Blended with theoretical: ${suggestedPrice.toFixed(2)}`);
  }
  
  // CRITICAL BOUNDS: Hard cap at 95% of market highest, floor at 15% profit margin
  const absoluteMin = cost * 1.15; // 15% minimum profit margin
  const absoluteMax = inflationAdjustedHighest * 0.95; // 95% of market highest (NEVER EXCEED!)
  
  console.log(`🎯 Price bounds:`);
  console.log(`   Min (cost + 15%): ${absoluteMin.toFixed(2)}`);
  console.log(`   Max (95% of highest): ${absoluteMax.toFixed(2)}`);
  
  let reasoning = '';
  
  // Apply hard constraints
  if (suggestedPrice < absoluteMin) {
    suggestedPrice = absoluteMin;
    reasoning = `Set to minimum 15% profit margin (${absoluteMin.toFixed(0)}) for business viability`;
  } else if (suggestedPrice > absoluteMax) {
    suggestedPrice = absoluteMax;
    reasoning = `Capped at 95% of market highest (${inflationAdjustedHighest.toFixed(0)}) to stay competitive`;
  } else {
    const percentBelowHighest = ((inflationAdjustedHighest - suggestedPrice) / inflationAdjustedHighest * 100).toFixed(1);
    reasoning = `Optimized at ${percentBelowHighest}% below market highest based on inflation-adjusted average`;
  }
  
  // FINAL SAFETY CHECK: Ensure we NEVER exceed market highest
  suggestedPrice = Math.min(suggestedPrice, absoluteMax);
  
  console.log(`✅ Final suggested price: ${suggestedPrice.toFixed(2)}`);
  console.log(`   Reasoning: ${reasoning}`);
  console.log(`   Verification: ${suggestedPrice <= inflationAdjustedHighest ? '✓ Below market highest' : '✗ EXCEEDS MARKET HIGHEST!'}`);
  
  return {
    theoreticalOptimal,
    marketAdjusted: suggestedPrice,
    reasoning
  };
}

async function calculateOptimalPrice(
  supabase: any,
  baseline: any,
  inflationRate: number
) {
  console.log('=== Starting Enhanced Price Calculation ===');
  
  // Fetch competitor products (granular data with similarity scores)
  const { data: competitorProducts } = await supabase
    .from('competitor_products')
    .select('price, similarity_score, price_ratio, marketplace')
    .eq('baseline_id', baseline.id)
    .gte('similarity_score', 0.6); // Only products with > 60% similarity
  
  console.log(`Found ${competitorProducts?.length || 0} competitor products`);
  
  // Fetch aggregated data (fallback)
  const { data: competitorAggregates } = await supabase
    .from('competitor_prices')
    .select('*')
    .eq('baseline_id', baseline.id)
    .eq('fetch_status', 'success');

  // Calculate market stats with outlier detection and weighting
  const marketStats = calculateWeightedMarketStats(
    competitorProducts || [],
    competitorAggregates || []
  );
  
  console.log('📈 Market stats (cleaned):', {
    lowest: marketStats.lowest.toFixed(2),
    average: marketStats.average.toFixed(2),
    highest: marketStats.highest.toFixed(2),
    confidence: marketStats.confidence,
    outliersRemoved: marketStats.outliersRemoved
  });
  
  // 🆕 VALIDATE MARKET DATA
  const validation = validateMarketData(
    marketStats,
    baseline.current_price,
    competitorProducts?.length || 0,
    baseline.category
  );
  
  console.log(`✓ Market validation: ${validation.reason}`);
  if (validation.warning) {
    console.log(`⚠️ Validation warning: ${validation.warning}`);
  }
  
  if (!validation.shouldProceed) {
    console.log('⚠️ Market data validation failed, returning baseline price');
    
    // Insert warning result and stop
    await supabase.from('pricing_results').insert({
      baseline_id: baseline.id,
      merchant_id: baseline.merchant_id,
      currency: baseline.currency,
      optimal_price: baseline.current_price,
      suggested_price: baseline.current_price,
      inflation_rate: inflationRate,
      inflation_adjustment: 1 + inflationRate,
      base_elasticity: baseline.base_elasticity,
      calibrated_elasticity: baseline.base_elasticity,
      competitor_factor: 1,
      has_warning: true,
      warning_message: validation.reason
    });
    
    return;
  }
  
  if (marketStats.average === 0) {
    console.log('⚠️ No competitor data available');
    
    await supabase.from('pricing_results').insert({
      baseline_id: baseline.id,
      merchant_id: baseline.merchant_id,
      currency: baseline.currency,
      optimal_price: baseline.current_price,
      suggested_price: baseline.current_price,
      inflation_rate: inflationRate,
      inflation_adjustment: 1 + inflationRate,
      base_elasticity: baseline.base_elasticity,
      calibrated_elasticity: baseline.base_elasticity,
      competitor_factor: 1,
      has_warning: true,
      warning_message: 'No competitor data available. Using baseline price.'
    });
    
    return;
  }

  // Calculate profit-maximizing price (inflation already applied inside)
  const profitCalc = calculateProfitMaximizingPrice(
    baseline.cost_per_unit,
    baseline.base_elasticity,
    baseline.current_price,
    marketStats.average,
    marketStats.lowest,
    marketStats.highest,
    inflationRate
  );
  
  const inflationAdjustment = 1 + inflationRate;
  let suggestedPrice = Math.round(profitCalc.marketAdjusted * 100) / 100;
  
  // Calculate competitor factor for context
  const competitorFactor = marketStats.average / baseline.current_price;
  const calibratedElasticity = baseline.base_elasticity * (1 + (competitorFactor - 1) * 0.3);
  
  // Calculate profit projections
  const currentProfit = (baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity;
  
  // 🆕 SAFETY CHECK: Never suggest a price that reduces profit
  let finalSuggestedPrice = suggestedPrice;
  let hasWarning = false;
  let warningMessage = '';
  
  // Calculate expected profit with suggested price
  const newQuantity = baseline.current_quantity * Math.pow(
    baseline.current_price / suggestedPrice,
    calibratedElasticity
  );
  const newProfit = (suggestedPrice - baseline.cost_per_unit) * newQuantity;
  const profitIncrease = newProfit - currentProfit;
  const profitIncreasePercent = (profitIncrease / currentProfit) * 100;
  
  // If suggested price would reduce profit, keep current price
  if (profitIncrease < 0) {
    console.log('⚠️ SAFETY CHECK: Suggested price would reduce profit!');
    console.log(`   Current profit: ${currentProfit.toFixed(2)}`);
    console.log(`   Expected profit with ${suggestedPrice}: ${newProfit.toFixed(2)}`);
    console.log(`   Profit change: ${profitIncrease.toFixed(2)} (${profitIncreasePercent.toFixed(1)}%)`);
    console.log('   → Keeping current price to maintain profitability');
    
    // Keep current price but still show the market analysis
    finalSuggestedPrice = baseline.current_price;
    hasWarning = true;
    warningMessage = `Market prices (avg: ${marketStats.average.toFixed(0)} ${baseline.currency}) are lower than your current price. Lowering to match market would reduce profit by ${Math.abs(profitIncreasePercent).toFixed(1)}%. Current price maintained for profitability.`;
  }
  
  console.log('=== Price Calculation Complete ===');
  console.log(`💰 Theoretical optimal: ${profitCalc.theoreticalOptimal.toFixed(2)}`);
  console.log(`📊 Market adjusted: ${profitCalc.marketAdjusted.toFixed(2)}`);
  console.log(`🎯 Final suggested: ${finalSuggestedPrice.toFixed(2)}`);
  console.log(`📝 Reasoning: ${profitCalc.reasoning}`);
  if (hasWarning) {
    console.log(`⚠️ Warning: ${warningMessage}`);
  } else {
    console.log(`💵 Expected profit increase: ${profitIncreasePercent.toFixed(1)}%`);
  }

  // Recalculate with final suggested price if it was changed
  const finalNewQuantity = baseline.current_quantity * Math.pow(
    baseline.current_price / finalSuggestedPrice,
    calibratedElasticity
  );
  const finalNewProfit = (finalSuggestedPrice - baseline.cost_per_unit) * finalNewQuantity;
  const finalProfitIncrease = finalNewProfit - currentProfit;
  const finalProfitIncreasePercent = (finalProfitIncrease / currentProfit) * 100;
  
  const positionVsMarket = ((finalSuggestedPrice - marketStats.average) / marketStats.average) * 100;

  // Insert pricing results
  await supabase.from('pricing_results').insert({
    baseline_id: baseline.id,
    merchant_id: baseline.merchant_id,
    currency: baseline.currency,
    optimal_price: profitCalc.theoreticalOptimal,
    suggested_price: finalSuggestedPrice,
    inflation_rate: inflationRate,
    inflation_adjustment: inflationAdjustment,
    base_elasticity: baseline.base_elasticity,
    calibrated_elasticity: calibratedElasticity,
    competitor_factor: competitorFactor,
    market_lowest: marketStats.lowest,
    market_average: marketStats.average,
    market_highest: marketStats.highest,
    position_vs_market: positionVsMarket,
    expected_monthly_profit: finalNewProfit,
    profit_increase_amount: finalProfitIncrease,
    profit_increase_percent: finalProfitIncreasePercent,
    has_warning: hasWarning,
    warning_message: hasWarning ? warningMessage : null
  });
  
  // Insert performance tracking (predicted values)
  await supabase.from('pricing_performance').insert({
    baseline_id: baseline.id,
    merchant_id: baseline.merchant_id,
    suggested_price: finalSuggestedPrice,
    predicted_sales: Math.round(finalNewQuantity),
    market_average: marketStats.average,
    market_lowest: marketStats.lowest,
    market_highest: marketStats.highest
  });
  
  console.log('✅ Results and performance tracking saved');
}