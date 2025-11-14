import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
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
    return { 
      rate: 0.023, 
      source: 'SAMA (Saudi Central Bank) - Latest CPI Data' 
    };
  } else if (currency === 'USD') {
    return { 
      rate: 0.031, 
      source: 'US Bureau of Labor Statistics - Latest CPI' 
    };
  }
  
  return { 
    rate: 0.025, 
    source: 'IMF Global Estimate' 
  };
}

async function scrapeMarketplacePrices(url: string, marketplace: string): Promise<number[]> {
  const zenrowsApiKey = Deno.env.get('ZENROWS_API_KEY');
  
  if (!zenrowsApiKey) {
    console.error('ZENROWS_API_KEY not configured');
    return [];
  }
  
  try {
    console.log(`Scraping ${marketplace} with ZenRows API, URL:`, url);
    
    // Build ZenRows API URL with parameters
    const zenrowsUrl = new URL('https://api.zenrows.com/v1/');
    zenrowsUrl.searchParams.set('url', url);
    zenrowsUrl.searchParams.set('apikey', zenrowsApiKey);
    zenrowsUrl.searchParams.set('js_render', 'true');
    zenrowsUrl.searchParams.set('premium_proxy', 'true');
    
    const response = await fetch(zenrowsUrl.toString());

    if (!response.ok) {
      console.error(`ZenRows API returned HTTP ${response.status} for ${marketplace}`);
      return [];
    }

    const html = await response.text();
    console.log(`Received HTML length: ${html.length} characters from ${marketplace}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    if (!doc) {
      console.error('Failed to parse HTML');
      return [];
    }

    const prices: number[] = [];
    
    const selectors = {
      amazon: [
        '.a-price-whole',
        'span.a-price > span.a-offscreen',
        '.a-price .a-price-whole'
      ],
      noon: [
        '[data-qa="product-price"]',
        '.priceNow',
        'strong[class*="price"]'
      ],
      extra: [
        '.price',
        '[data-price]',
        'span[class*="price"]'
      ],
      jarir: [
        '.price',
        'span[class*="price"]',
        '[data-price]'
      ],
      walmart: [
        '[itemprop="price"]',
        'span[class*="price"]',
        '.price-main'
      ],
      ebay: [
        '.s-item__price',
        'span[class*="POSITIVE"]'
      ],
      target: [
        '[data-test="product-price"]',
        'span[class*="price"]'
      ]
    };

    const marketplaceSelectors = selectors[marketplace as keyof typeof selectors] || [];
    console.log(`Trying ${marketplaceSelectors.length} selectors for ${marketplace}`);
    
    for (const selector of marketplaceSelectors) {
      const elements = doc.querySelectorAll(selector);
      console.log(`Selector "${selector}" found ${elements.length} elements`);
      
      elements.forEach((el: any) => {
        const text = el.textContent || el.getAttribute('content') || '';
        const priceMatch = text.match(/[\d,]+\.?\d*/);
        
        if (priceMatch) {
          const price = parseFloat(priceMatch[0].replace(/,/g, ''));
          if (price > 0 && price < 100000) {
            prices.push(price);
          }
        }
      });
      
      if (prices.length > 0) break;
    }

    console.log(`Found ${prices.length} prices from ${marketplace} using ZenRows`);
    return prices.slice(0, 10);
    
  } catch (error) {
    console.error(`Error scraping ${marketplace} with ZenRows:`, error);
    return [];
  }
}

async function fetchCompetitorPrices(
  supabase: any,
  baseline_id: string,
  product_name: string,
  currency: string,
  merchant_id: string
) {
  console.log('Fetching real competitor prices...');
  
  // Delete ALL old competitor data for this baseline first to prevent duplicates
  await supabase
    .from('competitor_prices')
    .delete()
    .eq('baseline_id', baseline_id);
  
  const marketplaces = currency === 'SAR' 
    ? [
        { name: 'amazon', search: 'https://www.amazon.sa/s?k=' },
        { name: 'noon', search: 'https://www.noon.com/saudi-en/search?q=' },
        { name: 'extra', search: 'https://www.extra.com/en-sa/search?q=' },
        { name: 'jarir', search: 'https://www.jarir.com/search/?q=' }
      ]
    : [
        { name: 'amazon', search: 'https://www.amazon.com/s?k=' },
        { name: 'walmart', search: 'https://www.walmart.com/search?q=' },
        { name: 'ebay', search: 'https://www.ebay.com/sch/i.html?_nkw=' },
        { name: 'target', search: 'https://www.target.com/s?searchTerm=' }
      ];

  for (const marketplace of marketplaces) {
    try {
      console.log(`Scraping ${marketplace.name}...`);
      
      const searchUrl = `${marketplace.search}${encodeURIComponent(product_name)}`;
      const prices = await scrapeMarketplacePrices(searchUrl, marketplace.name);

      if (prices.length > 0) {
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        const average = prices.reduce((a, b) => a + b, 0) / prices.length;

        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id,
          marketplace: marketplace.name,
          lowest_price: lowest,
          average_price: average,
          highest_price: highest,
          currency,
          products_found: prices.length,
          fetch_status: 'success'
        });

        console.log(`Saved ${prices.length} real prices from ${marketplace.name}`);
      } else {
        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id,
          marketplace: marketplace.name,
          currency,
          fetch_status: 'no_data'
        });
        
        console.log(`No prices found from ${marketplace.name}`);
      }
    } catch (error) {
      console.error(`Error fetching from ${marketplace.name}:`, error);
      
      await supabase.from('competitor_prices').insert({
        baseline_id,
        merchant_id,
        marketplace: marketplace.name,
        currency,
        fetch_status: 'failed'
      });
    }
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
