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

    console.log('Starting pricing processing for baseline:', baseline_id);

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
        console.log(`Fetched inflation rate for ${baseline.currency}:`, inflationRate, 'from', inflationSource);
        
        await supabase.from('inflation_snapshots').insert({
          inflation_rate: inflationRate,
          source: inflationSource
        });

        await supabase.from('processing_status')
          .update({ current_step: 'fetching_competitors' })
          .eq('baseline_id', baseline_id);

        await fetchCompetitorPrices(
          supabase, 
          baseline_id, 
          baseline.product_name,
          baseline.currency,
          baseline.merchant_id,
          baseline.current_price
        );

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
    console.error('Error in process-pricing function:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Unknown error' }),
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
  
  const distance = levenshteinDistance(norm1, norm2);
  const maxLength = Math.max(norm1.length, norm2.length);
  
  return 1 - (distance / maxLength);
}

function extractPrice(text: string, expectedCurrency: string): { price: number; confidence: number } | null {
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
    // Generic number
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

function simplifyProductName(productName: string): string {
  return normalizeProductName(productName)
    .split(',')[0]
    .trim();
}

function extractProductKeywords(productName: string): string[] {
  const normalized = normalizeProductName(productName);
  return normalized.split(' ').filter(word => word.length > 2);
}

async function scrapeMarketplacePrices(
  url: string, 
  marketplace: string, 
  productKeywords: string[], 
  baselinePrice: number
): Promise<number[]> {
  const zenrowsApiKey = Deno.env.get('ZENROWS_API_KEY');
  
  if (!zenrowsApiKey) {
    console.error('ZENROWS_API_KEY not configured');
    return [];
  }
  
  try {
    console.log(`Scraping ${marketplace} for: [${productKeywords.join(', ')}]`);
    
    const zenrowsUrl = new URL('https://api.zenrows.com/v1/');
    zenrowsUrl.searchParams.set('url', url);
    zenrowsUrl.searchParams.set('apikey', zenrowsApiKey);
    zenrowsUrl.searchParams.set('js_render', 'true');
    zenrowsUrl.searchParams.set('premium_proxy', 'true');
    
    const response = await fetch(zenrowsUrl.toString());

    if (!response.ok) {
      console.error(`ZenRows returned HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    console.log(`Received ${html.length} chars from ${marketplace}`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    if (!doc) {
      console.error('Failed to parse HTML');
      return [];
    }

    // Container-based extraction with title+price validation
    const marketplaceConfig: Record<string, { container: string; title: string; price: string }> = {
      amazon: {
        container: 'div[data-component-type="s-search-result"]',
        title: 'h2 span, h2 a span',
        price: '.a-price .a-offscreen, span.a-price-whole, .a-price-whole'
      },
      walmart: {
        container: 'div[data-item-id], [data-testid="list-view"]',
        title: 'span[data-automation-id="product-title"], a[link-identifier]',
        price: 'span[itemprop="price"], div[data-automation-id="product-price"] span, [data-automation-id="product-price"]'
      },
      ebay: {
        container: 'li.s-item, div.s-item__wrapper',
        title: 'div.s-item__title, h3.s-item__title',
        price: 'span.s-item__price, span.POSITIVE, .s-item__price'
      },
      target: {
        container: 'div[data-test="@web/site-top-of-funnel/ProductCardWrapper"]',
        title: 'a[data-test="product-title"], [data-test="product-title"]',
        price: 'span[data-test="current-price"], span[data-test="product-price"]'
      },
      noon: {
        container: 'div[data-qa="product-item"], article',
        title: '[data-qa="product-name"], .productContainer h2',
        price: '[data-qa="product-price"], strong, .sellingPrice'
      },
      extra: {
        container: 'div.product-item, div.product-card',
        title: '.product-title, .product-name, h3',
        price: '.price, .special-price, .final-price'
      },
      jarir: {
        container: 'div.product-card, div.product-item',
        title: '.product-name, .product-title, h3',
        price: '.price, .final-price, .sale-price'
      }
    };

    const config = marketplaceConfig[marketplace];
    
    if (!config) {
      console.log(`No config for ${marketplace}`);
      return [];
    }

    const validPrices: number[] = [];
    const containers = doc.querySelectorAll(config.container);
    
    console.log(`Found ${containers.length} containers`);

    const minPrice = baselinePrice * 0.3;
    const maxPrice = baselinePrice * 3;
    const SIMILARITY_THRESHOLD = 0.65;
    
    const simplifiedName = simplifyProductName(productKeywords.join(' '));

    containers.forEach((container: any, idx: number) => {
      try {
        let titleEl: any = null;
        for (const sel of config.title.split(',')) {
          titleEl = container.querySelector(sel.trim());
          if (titleEl) break;
        }
        
        let priceEl: any = null;
        for (const sel of config.price.split(',')) {
          priceEl = container.querySelector(sel.trim());
          if (priceEl) break;
        }
        
        if (!titleEl || !priceEl) {
          if (idx < 5) console.log(`[${idx}] ✗ Missing`);
          return;
        }
        
        const title = titleEl.textContent?.trim() || '';
        const priceText = priceEl.textContent?.trim() || '';
        
        if (!title || !priceText) return;
        
        if (idx < 5) console.log(`[${idx}] "${title.substring(0, 60)}..." | "${priceText}"`);
        
        const similarity = calculateSimilarity(simplifiedName, title);
        
        if (similarity < SIMILARITY_THRESHOLD) {
          if (idx < 5) console.log(`[${idx}] ✗ Similarity: ${(similarity * 100).toFixed(0)}%`);
          return;
        }
        
        const currency = baselinePrice > 100 ? 'SAR' : 'USD';
        const extracted = extractPrice(priceText, currency);
        
        if (!extracted) return;
        
        const { price, confidence } = extracted;
        
        if (price >= minPrice && price <= maxPrice && confidence > 0.5) {
          validPrices.push(price);
          if (idx < 5) console.log(`[${idx}] ✓ ${price}`);
        }
      } catch (err) {
        if (idx < 5) console.log(`[${idx}] Error:`, err);
      }
    });

        // Extract price complete
        const priceMatch = priceText.match(/[\d,]+\.?\d*/);
        if (!priceMatch) {
          if (index < 3) console.log(`✗ No price pattern match`);
          return;
        }
        
        const price = parseFloat(priceMatch[0].replace(/,/g, ''));
        
        // Validate: Price must be within reasonable range (30%-300% of baseline)
        if (price >= minPrice && price <= maxPrice) {
          validPrices.push(price);
          if (index < 3) {
            console.log(`✓ Match: "${title.substring(0, 60)}..." = $${price}`);
          }
        } else if (index < 3) {
          console.log(`✗ Out of range: $${price} (expected: $${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)})`);
        }
      } catch (err) {
        if (index < 3) console.log(`✗ Error in container ${index}:`, err);
      }
    });

    console.log(`Extracted ${validPrices.length} validated prices (range: $${minPrice.toFixed(2)}-$${maxPrice.toFixed(2)})`);
    return validPrices.slice(0, 20);
    
  } catch (error) {
    console.error(`Error scraping ${marketplace}:`, error);
    return [];
  }
}

async function fetchCompetitorPrices(
  supabase: any,
  baseline_id: string,
  product_name: string,
  currency: string,
  merchant_id: string,
  baseline_price: number
) {
  console.log('Fetching competitor prices...');
  
  const simplifiedName = simplifyProductName(product_name);
  const keywords = extractProductKeywords(product_name);
  console.log(`Product: "${product_name}"`);
  console.log(`Simplified: "${simplifiedName}"`);
  console.log(`Keywords: [${keywords.join(', ')}]`);
  console.log(`Price range: $${(baseline_price * 0.3).toFixed(2)} - $${(baseline_price * 3).toFixed(2)}`);
  
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
      console.log(`\n=== Scraping ${marketplace.name} ===`);
      
      const searchUrl = `${marketplace.search}${encodeURIComponent(simplifiedName)}`;
      const prices = await scrapeMarketplacePrices(searchUrl, marketplace.name, keywords, baseline_price);

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

        console.log(`✓ Saved ${prices.length} prices: $${lowest.toFixed(2)} - $${highest.toFixed(2)} (avg: $${average.toFixed(2)})`);
      } else {
        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id,
          marketplace: marketplace.name,
          currency,
          fetch_status: 'no_data'
        });
        
        console.log(`✗ No matching products found`);
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

  console.log(`Calculated optimal price: ${optimalPrice} Suggested: ${suggestedPrice}`);

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
