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

function simplifyProductName(productName: string): string {
  let simplified = productName.split(',')[0].trim();
  simplified = simplified.replace(/\([^)]*\)/g, '').trim();
  simplified = simplified.replace(/\s*-\s*.*/g, '').trim();
  
  const removePatterns = [/5G/gi, /4G/gi, /LTE/gi, /WiFi/gi, /Bluetooth/gi, /\d+GB/gi, /\d+\.\d+\s*inch/gi];
  removePatterns.forEach(pattern => {
    simplified = simplified.replace(pattern, '').trim();
  });
  
  simplified = simplified.replace(/\s+/g, ' ').trim();
  return simplified;
}

function extractProductKeywords(productName: string): string[] {
  const simplified = simplifyProductName(productName);
  return simplified.split(' ').filter(word => word.length > 2);
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
        title: 'h2 span',
        price: 'span.a-price > span.a-offscreen'
      },
      walmart: {
        container: 'div[data-item-id]',
        title: 'span[data-automation-id="product-title"]',
        price: 'div[data-automation-id="product-price"] span'
      },
      ebay: {
        container: 'li.s-item',
        title: 'div.s-item__title',
        price: 'span.s-item__price'
      },
      target: {
        container: 'div[data-test="@web/site-top-of-funnel/ProductCardWrapper"]',
        title: 'a[data-test="product-title"]',
        price: 'span[data-test="current-price"]'
      },
      noon: {
        container: 'div[data-qa="product-item"]',
        title: '[data-qa="product-name"]',
        price: '[data-qa="product-price"]'
      },
      extra: {
        container: 'div.product-item',
        title: '.product-title',
        price: '.price'
      },
      jarir: {
        container: 'div.product-card',
        title: '.product-name',
        price: '.price'
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

    containers.forEach((container: any, i: number) => {
      try {
        const titleEl = container.querySelector(config.title);
        const priceEl = container.querySelector(config.price);
        
        if (!titleEl || !priceEl) {
          if (i < 3) console.log(`✗ Missing - title: ${!!titleEl}, price: ${!!priceEl}`);
          return;
        }
        
        const title = titleEl.textContent?.trim().toLowerCase() || '';
        const priceText = priceEl.textContent?.trim() || '';
        
        if (i < 3) console.log(`Item ${i}: title="${title.substring(0, 80)}" price="${priceText}"`);
        
        // Validate: Title must contain at least 1 product keyword
        const matchCount = productKeywords.filter(kw => 
          title.includes(kw.toLowerCase())
        ).length;
        
        if (matchCount < 1) {
          if (i < 3) console.log(`✗ No keyword match`);
          return;
        }
        
        // Extract price
        const priceMatch = priceText.match(/[\d,]+\.?\d*/);
        if (!priceMatch) {
          if (i < 3) console.log(`✗ No price match`);
          return;
        }
        
        const price = parseFloat(priceMatch[0].replace(/,/g, ''));
        
        // Validate: Price must be within reasonable range (30%-300% of baseline)
        if (price >= minPrice && price <= maxPrice) {
          validPrices.push(price);
          if (i < 3) {
            console.log(`✓ "${title.substring(0, 50)}..." = $${price}`);
          }
        } else if (i < 3) {
          console.log(`✗ Out of range: $${price}`);
        }
      } catch (err) {
        if (i < 3) console.log(`✗ Error:`, err);
      }
    });

    console.log(`Extracted ${validPrices.length} prices`);
    return validPrices.slice(0, 20);
    
  } catch (error) {
    console.error(`Error:`, error);
    return [];
  }
}
