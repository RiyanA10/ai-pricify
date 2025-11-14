import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

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
    
    // Get baseline data and verify ownership
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

    const { product_name, currency, merchant_id } = baseline;

    console.log('Refreshing competitor data for baseline:', baseline_id);
    
    // Simplify product name for better search results
    const simplifiedName = simplifyProductName(product_name);
    console.log(`Original: "${product_name}" -> Simplified: "${simplifiedName}"`);

    // Delete old competitor data
    await supabase
      .from('competitor_prices')
      .delete()
      .eq('baseline_id', baseline_id);

    // Get marketplaces based on currency
    const marketplaces = getMarketplacesByCurrency(currency);

    // Fetch fresh competitor data
    const results = [];
    
    for (const marketplace of marketplaces) {
      try {
        console.log(`Fetching data from ${marketplace.name}...`);
        
        // Scrape real prices from marketplace
        const searchUrl = `${marketplace.search}${encodeURIComponent(simplifiedName)}`;
        console.log(`Scraping URL: ${searchUrl}`);
        
        const prices = await scrapeMarketplacePrices(searchUrl, marketplace.name);

        if (prices.length > 0) {
          const stats = {
            lowest: Math.min(...prices),
            average: prices.reduce((a, b) => a + b, 0) / prices.length,
            highest: Math.max(...prices),
            count: prices.length
          };

          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id,
            marketplace: marketplace.name,
            lowest_price: stats.lowest,
            average_price: stats.average,
            highest_price: stats.highest,
            products_found: stats.count,
            currency,
            fetch_status: 'success'
          });

          results.push({
            marketplace: marketplace.name,
            status: 'success',
            prices_found: stats.count,
            price_range: `${currency} ${stats.lowest.toFixed(2)} - ${stats.highest.toFixed(2)}`
          });
        } else {
          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id,
            marketplace: marketplace.name,
            currency,
            fetch_status: 'no_data'
          });

          results.push({
            marketplace: marketplace.name,
            status: 'no_data'
          });
        }
      } catch (error) {
        console.error(`Failed to fetch from ${marketplace.name}:`, error);
        
        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id,
          marketplace: marketplace.name,
          currency,
          fetch_status: 'failed'
        });

        results.push({
          marketplace: marketplace.name,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to fetch data'
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      refreshed_at: new Date().toISOString(),
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error refreshing competitors:', error);
    return new Response(JSON.stringify({ 
      error: 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function simplifyProductName(productName: string): string {
  // Remove common specifications and details that might not match across marketplaces
  let simplified = productName;
  
  // Remove detailed specs (anything after commas)
  simplified = simplified.split(',')[0].trim();
  
  // Remove size/storage/color info in parentheses or after dashes
  simplified = simplified.replace(/\([^)]*\)/g, '').trim();
  simplified = simplified.replace(/\s*-\s*.*/g, '').trim();
  
  // Remove common spec keywords  
  const removePatterns = [/5G/gi, /4G/gi, /LTE/gi, /WiFi/gi, /Bluetooth/gi, /\d+GB/gi, /\d+\.\d+\s*inch/gi];
  removePatterns.forEach(pattern => {
    simplified = simplified.replace(pattern, '').trim();
  });
  
  // Clean up extra spaces
  simplified = simplified.replace(/\s+/g, ' ').trim();
  
  return simplified;
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
    
    // Define selectors for each marketplace
    const selectors = {
      amazon: [
        'span.a-price > span.a-offscreen',
        '.a-price-whole',
        'span[data-a-size="xl"] > span.a-offscreen'
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
        'span[itemprop="price"]',
        '[data-automation-id="product-price"]',
        'div[data-testid="list-view"] span[class*="price"]'
      ],
      ebay: [
        'span.s-item__price',
        'span.textSpan',
        'div.x-price-primary > span'
      ],
      target: [
        'span[data-test="product-price"]',
        'span[data-test="current-price"]',
        'div[data-test="product-price"] span'
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

    // Fallback: Search entire body text for price patterns if selectors failed
    if (prices.length === 0) {
      console.log(`Selector-based extraction failed, trying text-based extraction for ${marketplace}`);
      const bodyText = doc.body?.textContent || '';
      
      // ONLY extract prices with clear currency indicators to avoid false positives
      const pricePatterns = [
        /(?:SAR|SR|ر\.س\.?)\s*[\d,]+\.?\d{0,2}/gi,  // SAR with prefix
        /[\d,]+\.?\d{0,2}\s*(?:SAR|SR|ر\.س\.?)/gi,  // SAR with suffix
        /\$[\d,]+\.?\d{0,2}/gi,                      // USD with $ prefix (no space)
        /USD\s*[\d,]+\.?\d{0,2}/gi                   // USD with text prefix
      ];
      
      const seenPrices = new Set<number>();
      
      pricePatterns.forEach(pattern => {
        const matches = bodyText.match(pattern);
        if (matches) {
          matches.forEach((match) => {
            const numMatch = match.match(/[\d,]+\.?\d*/);
            if (numMatch) {
              const price = parseFloat(numMatch[0].replace(/,/g, ''));
              // Stricter price range and deduplicate
              if (price > 50 && price < 50000 && !seenPrices.has(price)) {
                prices.push(price);
                seenPrices.add(price);
              }
            }
          });
        }
      });
      
      // Limit to reasonable number of prices
      if (prices.length > 50) {
        prices.sort((a, b) => a - b);
        prices.splice(50);
      }
      
      console.log(`Extracted ${prices.length} unique prices from text with currency indicators`);
    }

    console.log(`Found ${prices.length} prices from ${marketplace} using ZenRows`);
    return prices.slice(0, 10);
    
  } catch (error) {
    console.error(`Error scraping ${marketplace} with ZenRows:`, error);
    return [];
  }
}

function getMarketplacesByCurrency(currency: string) {
  if (currency === 'SAR') {
    return [
      { name: 'amazon', domain: 'amazon.sa', search: 'https://www.amazon.sa/s?k=' },
      { name: 'noon', domain: 'noon.com/saudi-en', search: 'https://www.noon.com/saudi-en/search?q=' },
      { name: 'extra', domain: 'extra.com/en-sa', search: 'https://www.extra.com/en-sa/search?q=' },
      { name: 'jarir', domain: 'jarir.com', search: 'https://www.jarir.com/search/?q=' }
    ];
  } else if (currency === 'USD') {
    return [
      { name: 'amazon', domain: 'amazon.com', search: 'https://www.amazon.com/s?k=' },
      { name: 'walmart', domain: 'walmart.com', search: 'https://www.walmart.com/search?q=' },
      { name: 'ebay', domain: 'ebay.com', search: 'https://www.ebay.com/sch/i.html?_nkw=' },
      { name: 'target', domain: 'target.com', search: 'https://www.target.com/s?searchTerm=' }
    ];
  }
  
  throw new Error(`Unsupported currency: ${currency}`);
}
