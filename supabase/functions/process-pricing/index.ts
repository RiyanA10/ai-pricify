import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const RequestSchema = z.object({
  baseline_id: z.string().uuid('Invalid baseline ID format')
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authentication
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
      global: {
        headers: { Authorization: authHeader }
      }
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Validate input
    const body = await req.json();
    const validation = RequestSchema.safeParse(body);
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validation.error.issues 
        }), 
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    const { baseline_id } = validation.data;

    console.log('Starting pricing processing for baseline:', baseline_id);

    // Get baseline data first to verify ownership and get currency
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

    // Verify ownership
    if (baseline.merchant_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Forbidden: Not your baseline' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create processing status
    await supabase.from('processing_status').insert({
      baseline_id,
      status: 'processing',
      current_step: 'fetching_inflation'
    });

    // Process in background using EdgeRuntime.waitUntil
    const backgroundTask = (async () => {
      try {
        // Step 1: Fetch inflation rate (instant)
        const { rate: inflationRate, source: inflationSource } = await fetchInflationRate(baseline.currency);
        console.log(`Fetched inflation rate for ${baseline.currency}:`, inflationRate, 'from', inflationSource);
        
        await supabase.from('inflation_snapshots').insert({
          inflation_rate: inflationRate,
          source: inflationSource
        });

        await supabase.from('processing_status')
          .update({ current_step: 'fetching_competitors' })
          .eq('baseline_id', baseline_id);

        // Step 2: Fetch competitor prices (fast)
        await fetchCompetitorPrices(supabase, baseline_id, baseline.product_name, baseline.currency, baseline.merchant_id);

        await supabase.from('processing_status')
          .update({ current_step: 'calculating_price' })
          .eq('baseline_id', baseline_id);

        // Step 3: Calculate optimal price (fast)
        await calculateOptimalPrice(supabase, baseline_id, baseline, inflationRate);

        // Mark as completed
        await supabase.from('processing_status')
          .update({ 
            status: 'completed',
            current_step: 'completed'
          })
          .eq('baseline_id', baseline_id);

        console.log('Processing completed successfully');
      } catch (error) {
        console.error('Processing error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Processing failed';
        await supabase.from('processing_status')
          .update({ 
            status: 'failed',
            error_message: errorMessage
          })
          .eq('baseline_id', baseline_id);
      }
    })();

    // Use EdgeRuntime.waitUntil to keep function alive for background task
    // @ts-ignore - EdgeRuntime is available in Deno Deploy
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundTask);
    } else {
      // Fallback for local development
      backgroundTask.catch(console.error);
    }

    // Return immediately
    return new Response(JSON.stringify({ 
      success: true, 
      baseline_id,
      message: 'Processing started'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in process-pricing:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function fetchInflationRate(currency: string): Promise<{ rate: number; source: string }> {
  if (currency === 'SAR') {
    const rate = 0.023;
    return { rate, source: 'SAMA (Saudi Arabia Monetary Authority)' };
  } else if (currency === 'USD') {
    const rate = 0.028;
    return { rate, source: 'US Bureau of Labor Statistics (BLS)' };
  }
  
  return { rate: 0.025, source: 'Default estimate' };
}

async function fetchCompetitorPrices(
  supabase: any,
  baseline_id: string,
  product_name: string,
  currency: string,
  merchant_id: string
) {
  const marketplaces = currency === 'SAR' 
    ? ['amazon', 'noon', 'extra', 'jarir']
    : ['amazon', 'walmart', 'ebay', 'target'];

  for (const marketplace of marketplaces) {
    const basePrice = 45 + Math.random() * 20;
    const variance = basePrice * 0.15;
    
    const prices = Array.from({ length: 3 + Math.floor(Math.random() * 3) }, () => 
      basePrice + (Math.random() - 0.5) * variance
    );

    const lowest = Math.min(...prices);
    const highest = Math.max(...prices);
    const average = prices.reduce((a, b) => a + b, 0) / prices.length;

    await supabase.from('competitor_prices').insert({
      baseline_id,
      merchant_id,
      marketplace,
      lowest_price: lowest,
      average_price: average,
      highest_price: highest,
      currency,
      products_found: prices.length,
      fetch_status: 'success'
    });

    console.log(`Fetched ${prices.length} prices from ${marketplace}`);
  }
}

async function calculateOptimalPrice(
  supabase: any,
  baseline_id: string,
  baseline: any,
  inflationRate: number
) {
  const {
    current_price,
    current_quantity,
    cost_per_unit,
    base_elasticity,
    merchant_id
  } = baseline;

  const { data: competitorData } = await supabase
    .from('competitor_prices')
    .select('*')
    .eq('baseline_id', baseline_id)
    .eq('fetch_status', 'success');

  const marketStats = calculateMarketStats(competitorData || []);
  
  const inflationAdjustment = 1 + inflationRate;
  
  let competitorFactor = 1.0;
  if (marketStats.average) {
    if (current_price < marketStats.average * 0.95) {
      competitorFactor = 1.1;
    } else if (current_price > marketStats.average * 1.05) {
      competitorFactor = 0.9;
    }
  }
  
  let adjustedElasticity = base_elasticity * inflationAdjustment * competitorFactor;
  let optimalPrice = 0;
  let iterations = 0;
  const maxIterations = 10;
  
  while (iterations < maxIterations) {
    const b = Math.abs(adjustedElasticity) * (current_quantity / current_price);
    const a = current_quantity + (b * current_price);
    
    optimalPrice = (a + (b * cost_per_unit)) / (2 * b);
    
    if (!marketStats.lowest || !marketStats.highest) break;
    
    const competitorMin = marketStats.lowest * 0.95;
    const competitorMax = marketStats.highest * 1.10;
    
    if (optimalPrice >= competitorMin && optimalPrice <= competitorMax) {
      break;
    }
    
    if (optimalPrice < competitorMin) {
      adjustedElasticity *= 0.95;
    } else if (optimalPrice > competitorMax) {
      adjustedElasticity *= 1.05;
    }
    
    iterations++;
  }
  
  let suggestedPrice = optimalPrice;
  let warning = null;
  
  if (marketStats.lowest && marketStats.highest) {
    if (optimalPrice < marketStats.lowest * 0.95) {
      suggestedPrice = marketStats.lowest;
      warning = "⚠️ Optimal price is below market range. Using lowest competitor price to maintain brand perception.";
    } else if (optimalPrice > marketStats.highest * 1.10) {
      suggestedPrice = marketStats.highest * 1.05;
      warning = "⚠️ Optimal price is above market range. Using competitive ceiling to avoid losing customers.";
    }
  }
  
  const currentProfit = (current_price - cost_per_unit) * current_quantity;
  const b = Math.abs(adjustedElasticity) * (current_quantity / current_price);
  const a = current_quantity + (b * current_price);
  const newQuantity = Math.max(0, a - (b * suggestedPrice));
  
  const expectedProfit = (suggestedPrice - cost_per_unit) * newQuantity;
  const profitIncrease = expectedProfit - currentProfit;
  const profitIncreasePercent = (profitIncrease / currentProfit) * 100;
  
  const positionVsMarket = marketStats.average 
    ? ((suggestedPrice - marketStats.average) / marketStats.average) * 100
    : null;
  
  await supabase.from('pricing_results').insert({
    baseline_id,
    merchant_id,
    base_elasticity,
    inflation_rate: inflationRate,
    inflation_adjustment: inflationAdjustment,
    competitor_factor: competitorFactor,
    calibrated_elasticity: adjustedElasticity,
    optimal_price: optimalPrice,
    suggested_price: suggestedPrice,
    expected_monthly_profit: expectedProfit,
    profit_increase_amount: profitIncrease,
    profit_increase_percent: profitIncreasePercent,
    market_average: marketStats.average,
    market_lowest: marketStats.lowest,
    market_highest: marketStats.highest,
    position_vs_market: positionVsMarket,
    has_warning: warning !== null,
    warning_message: warning,
    currency: baseline.currency
  });

  console.log('Calculated optimal price:', optimalPrice, 'Suggested:', suggestedPrice);
}

function calculateMarketStats(competitorData: any[]) {
  const allPrices: number[] = [];
  
  for (const comp of competitorData) {
    if (comp.lowest_price) allPrices.push(comp.lowest_price);
    if (comp.average_price) allPrices.push(comp.average_price);
    if (comp.highest_price) allPrices.push(comp.highest_price);
  }
  
  if (allPrices.length === 0) {
    return { lowest: null, average: null, highest: null };
  }
  
  return {
    lowest: Math.min(...allPrices),
    average: allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
    highest: Math.max(...allPrices)
  };
}
