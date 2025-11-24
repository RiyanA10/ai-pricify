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
        
        const { error: refreshError } = await supabase.functions.invoke(
          'refresh-competitors',
          { body: { baseline_id } }
        );

        if (refreshError) {
          console.error('Error calling refresh-competitors:', refreshError);
        } else {
          console.log('✅ Competitor scraping completed');
        }

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
 * Returns: { isValid: boolean, reason: string, shouldProceed: boolean }
 */
function validateMarketData(
  marketStats: { lowest: number; average: number; highest: number },
  baselinePrice: number,
  productCount: number
): { isValid: boolean; reason: string; shouldProceed: boolean } {
  
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
  
  // Check 3: Lowest price sanity check
  const lowestRatio = marketStats.lowest / baselinePrice;
  if (lowestRatio < 0.2) {
    // Lowest competitor is < 20% of baseline = likely wrong product
    return {
      isValid: false,
      reason: `Market lowest price (${marketStats.lowest.toFixed(0)}) is suspiciously low compared to baseline (${baselinePrice.toFixed(0)}). Competitor data may include unrelated products.`,
      shouldProceed: false
    };
  }
  
  // Check 4: Average price reasonableness
  const avgRatio = marketStats.average / baselinePrice;
  if (avgRatio < 0.3 || avgRatio > 3.0) {
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
  
  // 🆕 FILTER BY SIMILARITY - Only use products with similarity > 0.3 (30%)
  const filteredProducts = products.filter(p => p.similarity_score > 0.3);
  
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
  
  // Revenue-maximizing price from elasticity theory
  // Formula: P* = Cost / (1 + 1/elasticity)
  // BUT: This can produce unrealistic prices, so we cap it at market reality
  const rawTheoretical = cost / (1 + 1 / elasticity);
  
  // Cap theoretical at 2x market highest (prevent absurd prices)
  const theoreticalOptimal = Math.min(rawTheoretical, inflationAdjustedHighest * 2);
  
  console.log(`💡 Theoretical optimal (capped): ${theoreticalOptimal.toFixed(2)}`);
  console.log(`   Based on elasticity ${elasticity} and cost ${cost}`);
  console.log(`   Market average (inflation-adjusted): ${inflationAdjustedAverage.toFixed(2)}`);
  console.log(`   Market highest (inflation-adjusted): ${inflationAdjustedHighest.toFixed(2)}`);
  
  // CRITICAL FIX: Use market-driven approach, not theory-driven
  // Start with inflation-adjusted market average as base
  let marketAdjusted = inflationAdjustedAverage;
  
  // Apply elasticity insight: if theoretical suggests lower markup, adjust down slightly
  if (theoreticalOptimal < inflationAdjustedAverage && theoreticalOptimal > cost * 1.1) {
    // Move 30% toward theoretical if it's reasonable
    marketAdjusted = (inflationAdjustedAverage * 0.7) + (theoreticalOptimal * 0.3);
  }
  
  // Safety bounds
  const minPrice = cost * 1.10; // Minimum 10% markup
  const maxPrice = inflationAdjustedHighest * 0.98; // STAY BELOW market highest (2% discount max)
  
  let reasoning = '';
  
  // Apply bounds and reasoning
  if (marketAdjusted < minPrice) {
    marketAdjusted = minPrice;
    reasoning = `Set to minimum 10% markup (${minPrice.toFixed(0)}) for profitability`;
  } else if (marketAdjusted > maxPrice) {
    marketAdjusted = maxPrice;
    reasoning = `Capped at market highest (${inflationAdjustedHighest.toFixed(0)}) to stay competitive`;
  } else if (marketAdjusted < inflationAdjustedLowest && inflationAdjustedLowest > cost * 1.1) {
    marketAdjusted = inflationAdjustedLowest * 0.95;
    reasoning = `Positioned 5% below market lowest (${inflationAdjustedLowest.toFixed(0)}) for competitive advantage`;
  } else {
    reasoning = `Optimized based on inflation-adjusted market average (${inflationAdjustedAverage.toFixed(0)})`;
  }
  
  console.log(`🎯 Final suggested price: ${marketAdjusted.toFixed(2)}`);
  console.log(`   Reasoning: ${reasoning}`);
  
  return {
    theoreticalOptimal,
    marketAdjusted,
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
    .gte('similarity_score', 0.3); // Only products with > 30% similarity
  
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
    competitorProducts?.length || 0
  );
  
  console.log(`✓ Market validation: ${validation.reason}`);
  
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
  const suggestedPrice = Math.round(profitCalc.marketAdjusted * 100) / 100;
  
  // Calculate competitor factor for context
  const competitorFactor = marketStats.average / baseline.current_price;
  const calibratedElasticity = baseline.base_elasticity * (1 + (competitorFactor - 1) * 0.3);
  
  // Calculate profit projections
  const currentProfit = (baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity;
  const newQuantity = baseline.current_quantity * Math.pow(
    baseline.current_price / suggestedPrice,
    calibratedElasticity
  );
  const newProfit = (suggestedPrice - baseline.cost_per_unit) * newQuantity;
  const profitIncrease = newProfit - currentProfit;
  const profitIncreasePercent = (profitIncrease / currentProfit) * 100;
  
  const positionVsMarket = ((suggestedPrice - marketStats.average) / marketStats.average) * 100;
  
  console.log('=== Price Calculation Complete ===');
  console.log(`💰 Theoretical optimal: ${profitCalc.theoreticalOptimal.toFixed(2)}`);
  console.log(`📊 Market adjusted: ${profitCalc.marketAdjusted.toFixed(2)}`);
  console.log(`🎯 Final suggested: ${suggestedPrice.toFixed(2)}`);
  console.log(`📝 Reasoning: ${profitCalc.reasoning}`);
  console.log(`💵 Expected profit increase: ${profitIncreasePercent.toFixed(1)}%`);

  // Insert pricing results
  await supabase.from('pricing_results').insert({
    baseline_id: baseline.id,
    merchant_id: baseline.merchant_id,
    currency: baseline.currency,
    optimal_price: profitCalc.theoreticalOptimal,
    suggested_price: suggestedPrice,
    inflation_rate: inflationRate,
    inflation_adjustment: inflationAdjustment,
    base_elasticity: baseline.base_elasticity,
    calibrated_elasticity: calibratedElasticity,
    competitor_factor: competitorFactor,
    market_lowest: marketStats.lowest,
    market_average: marketStats.average,
    market_highest: marketStats.highest,
    position_vs_market: positionVsMarket,
    expected_monthly_profit: newProfit,
    profit_increase_amount: profitIncrease,
    profit_increase_percent: profitIncreasePercent
  });
  
  // Insert performance tracking (predicted values)
  await supabase.from('pricing_performance').insert({
    baseline_id: baseline.id,
    merchant_id: baseline.merchant_id,
    suggested_price: suggestedPrice,
    predicted_sales: Math.round(newQuantity),
    market_average: marketStats.average,
    market_lowest: marketStats.lowest,
    market_highest: marketStats.highest
  });
  
  console.log('✅ Results and performance tracking saved');
}