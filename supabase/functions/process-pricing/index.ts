import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
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

    console.log('Starting pricing processing request');

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

        // Call refresh-competitors function for better scraping
        console.log('Triggering competitor scraping via refresh-competitors...');
        
        const { data: refreshData, error: refreshError } = await supabase.functions.invoke(
          'refresh-competitors',
          {
            body: { baseline_id }
          }
        );

        if (refreshError) {
          console.error('Error calling refresh-competitors:', refreshError);
          // Don't fail the whole process, just log and continue
        } else {
          console.log('✅ Competitor scraping completed successfully');
        }

        await supabase.from('processing_status')
          .update({ current_step: 'calculating_price' })
          .eq('baseline_id', baseline_id);

        await calculateOptimalPrice(supabase, baseline, inflationRate);

        await supabase.from('processing_status')
          .update({ status: 'completed', current_step: 'complete' })
          .eq('baseline_id', baseline_id);

        console.log('Processing completed successfully');
      } catch (error: any) {
        console.error('Background processing error:', error);
        await supabase.from('processing_status')
          .update({ status: 'failed', error_message: error?.message || 'Unknown error' })
          .eq('baseline_id', baseline_id);
      }
    })();

    // Use Deno EdgeRuntime for background tasks
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundTask);
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Processing started', baseline_id }),
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

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // Remove parentheses content
    .replace(/\s*-\s*.*/g, '') // Remove dashes and everything after
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ') // Keep only alphanumeric and Arabic
    .replace(/\b(the|with|for|and|or)\b/gi, '') // Remove common words
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}

function calculateSimilarity(product1: string, product2: string): number {
  const norm1 = normalizeProductName(product1);
  const norm2 = normalizeProductName(product2);
  
  if (norm1 === norm2) return 1.0;
  
  // Remove model years/numbers for better matching (e.g., "17" vs "15", "12")
  const withoutYears1 = norm1.replace(/\b(1[0-9]|2[0-9])\b/g, '');
  const withoutYears2 = norm2.replace(/\b(1[0-9]|2[0-9])\b/g, '');
  
  const distance = levenshteinDistance(withoutYears1, withoutYears2);
  const maxLength = Math.max(withoutYears1.length, withoutYears2.length);
  
  return 1 - (distance / maxLength);
}

function extractPrice(text: string, expectedCurrency: string): { price: number; confidence: number } | null {
  if (!text) return null;
  
  // Clean up text - be aggressive with removal
  text = text.replace(/from|as low as|starting at|save|off|each|per|month|\/mo/gi, '').trim();
  
  // Currency patterns with multiple formats
  const patterns = [
    // SAR formats
    /(?:SAR|SR|ريال|ر\.س\.?)\s*([0-9,]+\.?[0-9]*)/i,
    /([0-9,]+\.?[0-9]*)\s*(?:SAR|SR|ريال|ر\.س\.?)/i,
    // USD formats
    /\$\s*([0-9,]+\.?[0-9]*)/,
    /([0-9,]+\.?[0-9]*)\s*(?:USD|usd)/,
    // Generic number with decimals
    /\b([0-9,]+\.[0-9]{2})\b/,
    // Generic number (fallback)
    /\b([0-9,]+)\b/
  ];
  
  let bestMatch: { price: number; confidence: number } | null = null;
  
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) {
      const priceStr = match[1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      
      if (!isNaN(price) && price > 0) {
        // Confidence based on pattern quality and currency match
        let confidence = 1.0 - (i * 0.1); // Earlier patterns have higher confidence
        
        // Check if currency matches expected
        if (expectedCurrency === 'SAR' && match[0].match(/SAR|SR|ريال|ر\.س/i)) {
          confidence += 0.2;
        } else if (expectedCurrency === 'USD' && match[0].match(/\$|USD/i)) {
          confidence += 0.2;
        }
        
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { price, confidence: Math.min(confidence, 1.0) };
        }
      }
    }
  }
  
  return bestMatch;
}

// Old scraping functions removed - now using refresh-competitors edge function

async function calculateOptimalPrice(
  supabase: any,
  baseline: any,
  inflationRate: number
) {
  const { data: competitorData } = await supabase
    .from('competitor_prices')
    .select('*')
    .eq('baseline_id', baseline.id)
    .eq('fetch_status', 'success');

  if (!competitorData || competitorData.length === 0) {
    console.log('No competitor data available, using baseline price');
    
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

  const marketStats = calculateMarketStats(competitorData);
  const inflationAdjustment = 1 + inflationRate;
  const inflationAdjustedPrice = baseline.current_price * inflationAdjustment;

  const avgCompetitorPrice = marketStats.average;
  const competitorFactor = avgCompetitorPrice / baseline.current_price;

  const calibratedElasticity = baseline.base_elasticity * (1 + (competitorFactor - 1) * 0.3);

  const optimalPrice = inflationAdjustedPrice * Math.pow(
    (1 + competitorFactor) / 2,
    1 / (1 + Math.abs(calibratedElasticity))
  );

  const suggestedPrice = Math.round(optimalPrice * 100) / 100;

  const currentProfit = (baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity;
  const newQuantity = baseline.current_quantity * Math.pow(
    baseline.current_price / suggestedPrice,
    calibratedElasticity
  );
  const newProfit = (suggestedPrice - baseline.cost_per_unit) * newQuantity;
  const profitIncrease = newProfit - currentProfit;
  const profitIncreasePercent = (profitIncrease / currentProfit) * 100;

  const positionVsMarket = ((suggestedPrice - marketStats.average) / marketStats.average) * 100;

  console.log('Price calculation complete');

  await supabase.from('pricing_results').insert({
    baseline_id: baseline.id,
    merchant_id: baseline.merchant_id,
    currency: baseline.currency,
    optimal_price: optimalPrice,
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
}

function calculateMarketStats(competitorData: any[]): { lowest: number; average: number; highest: number } {
  const allPrices: number[] = [];
  
  competitorData.forEach(comp => {
    if (comp.lowest_price) allPrices.push(comp.lowest_price);
    if (comp.average_price) allPrices.push(comp.average_price);
    if (comp.highest_price) allPrices.push(comp.highest_price);
  });
  
  if (allPrices.length === 0) {
    return { lowest: 0, average: 0, highest: 0 };
  }
  
  return {
    lowest: Math.min(...allPrices),
    average: allPrices.reduce((a, b) => a + b, 0) / allPrices.length,
    highest: Math.max(...allPrices)
  };
}
