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
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Refreshing competitor prices for:', baseline.product_name);

    const simplifiedName = simplifyProductName(baseline.product_name);
    const keywords = extractProductKeywords(baseline.product_name);
    
    console.log(`Simplified: "${simplifiedName}"`);
    console.log(`Keywords: [${keywords.join(', ')}]`);

    await supabase
      .from('competitor_prices')
      .delete()
      .eq('baseline_id', baseline_id);

    const marketplaces = baseline.currency === 'SAR' 
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

    const results = [];

    for (const marketplace of marketplaces) {
      try {
        console.log(`\n=== Scraping ${marketplace.name} ===`);
        
        const searchUrl = `${marketplace.search}${encodeURIComponent(simplifiedName)}`;
        const prices = await scrapeMarketplacePrices(
          searchUrl, 
          marketplace.name, 
          keywords, 
          baseline.current_price
        );

        if (prices.length > 0) {
          const lowest = Math.min(...prices);
          const highest = Math.max(...prices);
          const average = prices.reduce((a, b) => a + b, 0) / prices.length;

          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: marketplace.name,
            lowest_price: lowest,
            average_price: average,
            highest_price: highest,
            currency: baseline.currency,
            products_found: prices.length,
            fetch_status: 'success'
          });

          results.push({
            marketplace: marketplace.name,
            status: 'success',
            products_found: prices.length,
            lowest,
            average,
            highest
          });

          console.log(`✓ ${prices.length} prices: $${lowest.toFixed(2)}-$${highest.toFixed(2)}`);
        } else {
          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: marketplace.name,
            currency: baseline.currency,
            fetch_status: 'no_data'
          });

          results.push({
            marketplace: marketplace.name,
            status: 'no_data'
          });

          console.log(`✗ No matching products`);
        }
      } catch (error: any) {
        console.error(`Error with ${marketplace.name}:`, error);
        
        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id: baseline.merchant_id,
          marketplace: marketplace.name,
          currency: baseline.currency,
          fetch_status: 'failed'
        });

        results.push({
          marketplace: marketplace.name,
          status: 'failed',
          error: error?.message || 'Unknown error'
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, baseline_id, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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
    console.log(`Searching for: [${productKeywords.join(', ')}]`);
    
    const zenrowsUrl = new URL('https://api.zenrows.com/v1/');
    zenrowsUrl.searchParams.set('url', url);
    zenrowsUrl.searchParams.set('apikey', zenrowsApiKey);
    zenrowsUrl.searchParams.set('js_render', 'true');
    zenrowsUrl.searchParams.set('premium_proxy', 'true');
    
    const response = await fetch(zenrowsUrl.toString());

    if (!response.ok) {
      console.error(`HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    console.log(`Received ${html.length} chars`);
    
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

    containers.forEach((container: any, i: number) => {
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
          if (i < 5) console.log(`[${i}] ✗ Missing - title: ${!!titleEl}, price: ${!!priceEl}`);
          return;
        }
        
        const title = titleEl.textContent?.trim() || '';
        const priceText = priceEl.textContent?.trim() || '';
        
        if (!title || !priceText) return;
        
        if (i < 5) console.log(`[${i}] "${title.substring(0, 60)}..." | price: "${priceText}"`);
        
        const similarity = calculateSimilarity(simplifiedName, title);
        
        if (similarity < SIMILARITY_THRESHOLD) {
          if (i < 5) console.log(`[${i}] ✗ Similarity: ${(similarity * 100).toFixed(0)}%`);
          return;
        }
        
        const currency = baselinePrice > 100 ? 'SAR' : 'USD';
        const extracted = extractPrice(priceText, currency);
        
        if (!extracted) {
          if (i < 5) console.log(`[${i}] ✗ No price extracted`);
          return;
        }
        
        const { price, confidence } = extracted;
        
        if (price >= minPrice && price <= maxPrice && confidence > 0.5) {
          validPrices.push(price);
          if (i < 5) console.log(`[${i}] ✓ ${price} (sim:${(similarity*100).toFixed(0)}% conf:${(confidence*100).toFixed(0)}%)`);
        } else if (i < 5) {
          console.log(`[${i}] ✗ Invalid: price=${price}, range=[${minPrice}-${maxPrice}]`);
        }
      } catch (err) {
        if (i < 5) console.log(`[${i}] Error:`, err);
      }
    });

    console.log(`Extracted ${validPrices.length} prices`);
    return validPrices.slice(0, 20);
    
  } catch (error) {
    console.error(`Error:`, error);
    return [];
  }
}
