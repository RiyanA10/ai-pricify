import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ========================================
// MARKETPLACE CONFIGURATIONS
// ========================================

interface MarketplaceConfig {
  name: string;
  searchUrl: string;
  scrapingBeeOptions: {
    renderJs: boolean;
    wait: number;
    blockResources: boolean;
    blockAds: boolean;
    countryCode: string;
  };
  selectors: {
    containers: string[];
    productName: string[];
    price: string[];
  };
}

const MARKETPLACE_CONFIGS: Record<string, MarketplaceConfig> = {
  'google-shopping': {
    name: 'Google Shopping',
    searchUrl: 'https://www.google.com/search?tbm=shop&q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 3000,
      blockResources: true,
      blockAds: true,
      countryCode: 'us'
    },
    selectors: {
      containers: [
        '.sh-dgr__content',
        '[data-docid]',
        '.sh-dlr__list-result',
        'div[data-sh-pr]'
      ],
      productName: [
        'h3',
        '.sh-np__product-title',
        'div[role="heading"]',
        '[data-sh-pr] h4'
      ],
      price: [
        '.a8Pemb',
        'span[aria-label*="$"]',
        '[data-sh-pr] span:first-child',
        'b'
      ]
    }
  },
  'amazon': {
    name: 'Amazon.sa',
    searchUrl: 'https://www.amazon.sa/s?k=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        '[data-component-type="s-search-result"]',
        '.s-result-item[data-asin]:not([data-asin=""])',
        'div[data-asin]:not([data-asin=""])',
        '.s-search-results .s-result-item'
      ],
      productName: [
        'h2 a span',
        'h2.a-size-mini span',
        '.a-size-medium.a-text-normal',
        'h2 span.a-text-normal',
        '[data-cy="title-recipe"] h2 span'
      ],
      price: [
        '.a-price-whole',
        'span.a-price > span.a-offscreen',
        '.a-price .a-price-whole',
        'span[data-a-color="price"]',
        '.a-price-range .a-price .a-offscreen'
      ]
    }
  },
  'noon': {
    name: 'Noon',
    searchUrl: 'https://www.noon.com/saudi-en/search?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 5000,              // ✅ Increased for Noon
      blockResources: false,   // ✅ Don't block for Noon (prevents timeout)
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        '[data-qa="product-tile"]',
        'div.productContainer',
        'article[data-qa="product-tile"]',
        '.grid > div[class*="product"]',
        'div[class*="ProductBox"]',
        'div[data-qa="product-item"]',
        'article'
      ],
      productName: [
        '[data-qa="product-name"]',
        'div[class*="productTitle"]',
        'h3[class*="productTitle"]',
        '[class*="title"]',
        '.productContainer h2'
      ],
      price: [
        '[data-qa="product-price"]',
        'div[class*="price"] strong',
        'span[class*="price"]',
        '[class*="priceNow"]',
        'strong[class*="amount"]',
        'strong',
        '.sellingPrice'
      ]
    }
  },
  'extra': {
    name: 'Extra',
    searchUrl: 'https://www.extra.com/en-sa/search?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        'div[class*="ProductTile"]',
        'div[data-testid="product-tile"]',
        'article[class*="product"]',
        'div.product-tile',
        'li[class*="product"]',
        'div.product-item',
        'div.product-card'
      ],
      productName: [
        'h3[class*="title"]',
        'a[class*="title"]',
        'div[class*="productName"]',
        '[data-testid="product-title"]',
        'h3 a',
        '.product-title',
        '.product-name'
      ],
      price: [
        'span[class*="price"]',
        'div[class*="price"] span',
        '[data-testid="product-price"]',
        'span[class*="amount"]',
        'strong[class*="price"]',
        '.price',
        '.special-price',
        '.final-price'
      ]
    }
  },
  'jarir': {
    name: 'Jarir',
    searchUrl: 'https://www.jarir.com/search/?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        'div.product-item',
        'li.product-item',
        'div[class*="product"]',
        'div.item',
        'article[class*="product"]',
        'div.product-card'
      ],
      productName: [
        'a.product-item-link',
        'h2.product-name a',
        'a[class*="product-name"]',
        'div.product-name',
        'h3 a',
        '.product-title'
      ],
      price: [
        'span.price',
        'span[class*="price-value"]',
        'div.price-box span.price',
        'span[data-price-type="finalPrice"]',
        'span.special-price span.price',
        '.final-price',
        '.sale-price'
      ]
    }
  },
  'amazon-us': {
    name: 'Amazon.com',
    searchUrl: 'https://www.amazon.com/s?k=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'us'
    },
    selectors: {
      containers: [
        '[data-component-type="s-search-result"]',
        '.s-result-item[data-asin]:not([data-asin=""])',
        'div[data-asin]:not([data-asin=""])',
        '.s-search-results .s-result-item'
      ],
      productName: [
        'h2 a span',
        'h2.a-size-mini span',
        '.a-size-medium.a-text-normal',
        'h2 span.a-text-normal',
        '[data-cy="title-recipe"] h2 span'
      ],
      price: [
        '.a-price-whole',
        'span.a-price > span.a-offscreen',
        '.a-price .a-price-whole',
        'span[data-a-color="price"]',
        '.a-price-range .a-price .a-offscreen'
      ]
    }
  },
  'walmart': {
    name: 'Walmart',
    searchUrl: 'https://www.walmart.com/search?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'us'
    },
    selectors: {
      containers: [
        'div[data-item-id]',
        '[data-testid="list-view"]',
        'div[class*="search-result"]',
        '[data-testid="item-stack"]',
        'div[class*="mb0 ph1 pa0-xl"]',
        'article[class*="search"]'
      ],
      productName: [
        'span[data-automation-id="product-title"]',
        'a[link-identifier]',
        'span[data-automation-id="product-name"]'
      ],
      price: [
        'span[itemprop="price"]',
        'div[data-automation-id="product-price"] span',
        '[data-automation-id="product-price"]',
        'span[class*="price"]'
      ]
    }
  },
  'ebay': {
    name: 'eBay',
    searchUrl: 'https://www.ebay.com/sch/i.html?_nkw=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'us'
    },
    selectors: {
      containers: [
        'li.s-item',
        'div.s-item__wrapper',
        'div.srp-results li',
        'li[data-view]',
        'div.s-item'
      ],
      productName: [
        'div.s-item__title',
        'h3.s-item__title',
        '.s-item__title span'
      ],
      price: [
        'span.s-item__price',
        'span.POSITIVE',
        '.s-item__price',
        'span[class*="price"]'
      ]
    }
  },
  'target': {
    name: 'Target',
    searchUrl: 'https://www.target.com/s?searchTerm=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'us'
    },
    selectors: {
      containers: [
        'div[data-test="@web/site-top-of-funnel/ProductCardWrapper"]',
        'div[data-test="product-card"]',
        'article[class*="styles__StyledProductCard"]',
        'div[class*="ProductCard"]'
      ],
      productName: [
        'a[data-test="product-title"]',
        '[data-test="product-title"]',
        'div[data-test="product-title"] a',
        'h3 a',
        'a[class*="Link__StyledLink"]'
      ],
      price: [
        'span[data-test="current-price"]',
        'span[data-test="product-price"]',
        '[data-test="product-price"] span'
      ]
    }
  }
};

// ========================================
// HELPER FUNCTIONS
// ========================================

function trySelectAll(doc: any, selectors: string[]): any[] {
  for (const selector of selectors) {
    try {
      const elements = Array.from(doc.querySelectorAll(selector));
      if (elements.length > 0) {
        console.log(`✅ Found ${elements.length} elements with: ${selector}`);
        return elements;
      }
      console.log(`⚠️ No elements with: ${selector}`);
    } catch (e) {
      console.log(`❌ Invalid selector: ${selector}`);
    }
  }
  return [];
}

function trySelectOne(element: any, selectors: string[]): any | null {
  for (const selector of selectors) {
    try {
      const found = element.querySelector(selector);
      if (found) return found;
    } catch (e) {
      // Try next selector
    }
  }
  return null;
}

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^\w\s\u0600-\u06FF-]/g, ' ')
    .replace(/\b(the|with|for|and|or|in|new|original|genuine|authentic|official|brand)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeyTerms(name: string): string[] {
  const normalized = normalizeProductName(name);
  const terms = normalized.split(/\s+/).filter(term => 
    term.length > 2 && 
    !/^(gb|tb|inch|mm|cm)$/i.test(term)
  );
  return terms;
}

// Calculate Levenshtein distance between two strings for fuzzy matching
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

// Check if two terms are similar using fuzzy matching
function areTermsSimilar(term1: string, term2: string): boolean {
  if (term1 === term2) return true; // Exact match
  
  const minLength = Math.min(term1.length, term2.length);
  const maxLength = Math.max(term1.length, term2.length);
  
  // Short terms (< 4 chars) require exact match
  if (minLength < 4) return term1 === term2;
  
  const distance = levenshteinDistance(term1, term2);
  const threshold = Math.max(1, Math.floor(maxLength * 0.25)); // Allow 25% difference
  
  return distance <= threshold;
}

function calculateSimilarity(baselineProduct: string, competitorProduct: string): number {
  const baselineTerms = extractKeyTerms(baselineProduct);
  const competitorTerms = extractKeyTerms(competitorProduct);
  
  if (baselineTerms.length === 0 || competitorTerms.length === 0) return 0;
  
  const matches = new Set<string>();
  let hasModelMatch = false;
  let fuzzyMatchCount = 0;
  
  // Check both exact and fuzzy matches
  for (const baselineTerm of baselineTerms) {
    for (const competitorTerm of competitorTerms) {
      if (areTermsSimilar(baselineTerm, competitorTerm)) {
        matches.add(baselineTerm);
        
        // Check if it's a model number (contains both letters and digits)
        if (/\d/.test(baselineTerm) && /[a-z]/i.test(baselineTerm)) {
          hasModelMatch = true;
        }
        
        // Track if this was a fuzzy match
        if (baselineTerm !== competitorTerm) {
          fuzzyMatchCount++;
        }
        break; // Found a match, move to next baseline term
      }
    }
  }
  
  const matchCount = matches.size;
  let similarity = matchCount / baselineTerms.length;
  
  // Bonus for perfect matches
  if (matchCount === baselineTerms.length && fuzzyMatchCount === 0) {
    similarity = 0.95;
  }
  
  // Bonus for model number match
  if (hasModelMatch) {
    similarity = Math.min(similarity * 1.1, 1.0);
  }
  
  // Slight penalty for fuzzy matches (0-0.1 reduction)
  similarity = similarity * (1 - (fuzzyMatchCount * 0.05));
  
  return Math.max(0, similarity);
}

function extractPrice(text: string, expectedCurrency: string): { price: number; confidence: number } | null {
  if (!text) return null;
  
  text = text.replace(/from|as low as|starting at|save|off|each|per|month|\/mo/gi, '').trim();
  
  const patterns = [
    /(?:SAR|SR|ریال|ر\.س\.?)\s*([0-9,]+\.?[0-9]*)/i,
    /([0-9,]+\.?[0-9]*)\s*(?:SAR|SR|ریال|ر\.س\.?)/i,
    /\$\s*([0-9,]+\.?[0-9]*)/,
    /([0-9,]+\.?[0-9]*)\s*(?:USD|usd)/,
    /\b([0-9,]+\.[0-9]{2})\b/,
    /\b([0-9,]+)\b/
  ];
  
  let bestMatch: { price: number; confidence: number } | null = null;
  
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) {
      const priceStr = match[1].replace(/,/g, '');
      const price = parseFloat(priceStr);
      
      if (!isNaN(price) && price > 0) {
        let confidence = 1.0 - (i * 0.1);
        
        if (expectedCurrency === 'SAR' && match[0].match(/SAR|SR|ریال|ر\.س/i)) {
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

// ========================================
// PRODUCT NAME EXTRACTION
// ========================================

/**
 * Extract core product identifier (brand + model only)
 * Examples:
 *   "Sony WH-1000XM6 The Best Wireless..." → "Sony WH-1000XM6"
 *   "Apple iPhone 15 Pro Max 256GB Blue" → "Apple iPhone 15 Pro"
 *   "Samsung Galaxy S24 Ultra Premium Edition" → "Samsung Galaxy S24 Ultra"
 */
function extractCoreProductName(fullName: string): string {
  // Remove punctuation but keep spaces
  let cleaned = fullName.replace(/[^\w\s\u0600-\u06FF-]/g, ' ');
  
  // Marketing words to remove (NOT product categories!)
  const marketingWords = [
    'the', 'best', 'premium', 'deluxe', 'ultimate', 'professional',
    'wireless', 'bluetooth', 'noise', 'canceling', 'cancelling',
    'edition', 'version', 'original', 'authentic', 'genuine',
    'new', 'latest', 'upgraded', 'advanced', 'enhanced',
    'black', 'white', 'blue', 'red', 'silver', 'gold', 'gray', 'grey'
    // ❌ NOT removing: headphones, phone, laptop, tv, speaker, etc.
  ];
  
  const words = cleaned
    .toLowerCase()
    .split(/\s+/)
    .filter(word => {
      const hasNumbers = /\d/.test(word);
      const isMarketing = marketingWords.includes(word);
      return word.length > 1 && (!isMarketing || hasNumbers);
    });
  
  // Take first 4-5 words (brand + model + category)
  return words.slice(0, Math.min(5, words.length)).join(' ').trim();
}

// ========================================
// ACCESSORY DETECTION
// ========================================

/**
 * Detect if a product is an accessory or replacement part
 * Context-aware: Used to prevent accessories from contaminating main product pricing
 */
function isAccessoryOrReplacement(productName: string): boolean {
  const accessoryKeywords = [
    // Replacement parts
    'replacement', 'replace', 'spare', 'parts',
    
    // Ear accessories
    'earpads', 'ear pads', 'ear pad', 'cushion', 'cushions', 'foam', 'tips',
    
    // Cases & covers
    'case', 'cover', 'protective', 'pouch', 'bag', 'hard case', 'soft case',
    
    // Cables & adapters
    'cable', 'cord', 'wire', 'adapter', 'charger', 'charging cable',
    
    // Sets/pieces (not full product)
    'pcs', 'pieces', 'pair', 'set of', 'pack of', '2pcs', '3pcs', '4pcs',
    
    // Arabic
    'قطع غيار', 'قطع', 'غيار', 'بديل', 'حافظة', 'كفر', 'غطاء', 'وسادة', 'كابل'
  ];
  
  const lowerName = productName.toLowerCase();
  return accessoryKeywords.some(keyword => lowerName.includes(keyword));
}

// ========================================
// SCRAPING FUNCTION
// ========================================

interface ScrapedProduct {
  name: string;
  price: number;
  similarity: number;
  priceRatio: number;
  url?: string;
}

async function scrapeMarketplacePrices(
  config: MarketplaceConfig,
  productName: string,
  fullProductName: string,
  baselinePrice: number,
  currency: string
): Promise<ScrapedProduct[]> {
  const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  
  if (!scrapingbeeApiKey) {
    console.error('SCRAPINGBEE_API_KEY not configured');
    return [];
  }
  
  const searchUrl = config.searchUrl + encodeURIComponent(productName);
  console.log(`\n🐝 Scraping ${config.name}`);
  console.log(`   URL: ${searchUrl}`);
  console.log(`   Config:`, config.scrapingBeeOptions);
  
  let retries = 2;
  let lastError: any = null;
  
  while (retries >= 0) {
    try {
      const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
      sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
      sbUrl.searchParams.set('url', searchUrl);
      sbUrl.searchParams.set('render_js', String(config.scrapingBeeOptions.renderJs));
      sbUrl.searchParams.set('wait', String(config.scrapingBeeOptions.wait));
      sbUrl.searchParams.set('block_resources', String(config.scrapingBeeOptions.blockResources));
      sbUrl.searchParams.set('block_ads', String(config.scrapingBeeOptions.blockAds));
      sbUrl.searchParams.set('country_code', config.scrapingBeeOptions.countryCode);
      sbUrl.searchParams.set('premium_proxy', 'true');
      sbUrl.searchParams.set('wait_browser', 'load');
      
      const response = await fetch(sbUrl.toString());
      
      if (response.status === 500) {
        console.log(`⚠️ Got HTTP 500, retries left: ${retries}`);
        if (retries > 0) {
          retries--;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        const errorText = await response.text();
        console.error(`❌ HTTP 500 after retries: ${errorText}`);
        return [];
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ HTTP ${response.status}: ${errorText}`);
        return [];
      }
      
      const html = await response.text();
    console.log(`✅ Received ${html.length} chars`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc) return [];
    
    const containers = trySelectAll(doc, config.selectors.containers);
    if (containers.length === 0) {
      console.error(`❌ No containers found`);
      return [];
    }
    
    const products: ScrapedProduct[] = [];
    const normalizedBaseline = normalizeProductName(fullProductName);
    
    for (let i = 0; i < Math.min(containers.length, 50); i++) {
      const container = containers[i];
      
      const nameEl = trySelectOne(container, config.selectors.productName);
      if (!nameEl) continue;
      
      const name = nameEl.textContent?.trim();
      if (!name) continue;
      
      const priceEl = trySelectOne(container, config.selectors.price);
      if (!priceEl) continue;
      
      const priceText = priceEl.textContent?.trim();
      if (!priceText) continue;
      
      const extracted = extractPrice(priceText, currency);
      if (!extracted || extracted.price <= 0) continue;
      
      const normalizedCompetitor = normalizeProductName(name);
      const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
      const priceRatio = extracted.price / baselinePrice;
      
      let adjustedSimilarity = similarity;
      if (priceRatio < 0.2 || priceRatio > 5.0) {
        adjustedSimilarity = similarity * 0.5;
      } else if (priceRatio < 0.4 || priceRatio > 2.5) {
        adjustedSimilarity = similarity * 0.8;
      }
      
      // Try to extract product URL
      let productUrl: string | undefined;
      try {
        const linkEl = container.querySelector('a[href]');
        if (linkEl) {
          const href = linkEl.getAttribute('href');
          if (href) {
            productUrl = href.startsWith('http') ? href : new URL(href, config.searchUrl).href;
          }
        }
      } catch (e) {
        // Ignore URL extraction errors
      }
      
      // ✅ NO FILTERING - Store everything!
      products.push({
        name,
        price: extracted.price,
        similarity: adjustedSimilarity,
        priceRatio,
        url: productUrl
      });
      
      if (i < 5) {
        console.log(`   [${i}] "${name.substring(0, 50)}..."`);
        console.log(`       Similarity: ${(adjustedSimilarity * 100).toFixed(0)}%, Price: ${extracted.price}, Ratio: ${priceRatio.toFixed(2)}x`);
      }
    }
    
    console.log(`   Extracted ${products.length} products`);
    if (products.length === 0) {
      console.log(`   Debug: Found ${containers.length} containers but extracted 0 products`);
    }
    
    // Sort by similarity DESC, keep top 20
    return products
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 20);
    
    } catch (error: any) {
      lastError = error;
      if (retries > 0) {
        console.log(`⚠️ Error, retrying... (${retries} left)`);
        retries--;
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      console.error(`❌ Error after retries:`, error.message);
      return [];
    }
  }
  
  return [];
}

// ========================================
// MAIN REQUEST HANDLER
// ========================================

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

    console.log('Refreshing competitor prices');
    
    // Check if baseline product is an accessory
    const baselineIsAccessory = isAccessoryOrReplacement(baseline.product_name);
    console.log(`Baseline is ${baselineIsAccessory ? 'accessory' : 'main product'}`);
    console.log(`Filter mode: ${baselineIsAccessory ? 'Keep accessories' : 'Filter accessories'}`);
    
    // Extract core product name for better search results
    const coreProductName = extractCoreProductName(baseline.product_name);
    console.log('Using', coreProductName === baseline.product_name ? 'full name' : 'core product name');

    // Delete existing data for this baseline
    await supabase
      .from('competitor_prices')
      .delete()
      .eq('baseline_id', baseline_id);
    
    await supabase
      .from('competitor_products')
      .delete()
      .eq('baseline_id', baseline_id);

    const marketplaceKeys = baseline.currency === 'SAR' 
      ? ['amazon', 'noon', 'extra', 'jarir']
      : ['amazon-us', 'walmart', 'ebay', 'target'];

    const results = [];
    const lowConfidenceProducts: string[] = [];
    const failedMarketplaces: string[] = [];  // Track marketplaces that failed to find products
    let foundValidProducts = false;

    for (const marketplaceKey of marketplaceKeys) {
      try {
        const config = MARKETPLACE_CONFIGS[marketplaceKey];
        console.log(`\n=== Scraping ${config.name} ===`);
        
        let products = await scrapeMarketplacePrices(
          config,
          coreProductName,
          baseline.product_name,
          baseline.current_price,
          baseline.currency
        );
        
        // Apply smart filtering: If baseline is NOT an accessory, filter OUT accessories
        if (!baselineIsAccessory && products.length > 0) {
          const beforeFilter = products.length;
          products = products.filter(product => {
            const isAccessory = isAccessoryOrReplacement(product.name);
            if (isAccessory) {
              console.log(`⏭️ Filtered accessory: "${product.name.slice(0, 60)}..."`);
            }
            return !isAccessory;
          });
          console.log(`🔍 Filtering: ${beforeFilter} products → ${products.length} products (removed ${beforeFilter - products.length} accessories)`);
        }
        
        if (products.length > 0) {
          foundValidProducts = true;
          
          // Track low confidence products for potential Google fallback
          products.forEach(p => {
            if (p.similarity < 0.30) {
              lowConfidenceProducts.push(p.name);
            }
          });
          
          // Insert each product into competitor_products table
          const productRows = products.map((product, index) => ({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: marketplaceKey,
            product_name: product.name,
            price: product.price,
            similarity_score: product.similarity,
            price_ratio: product.priceRatio,
            product_url: product.url,
            currency: baseline.currency,
            rank: index + 1
          }));
          
          const { error: productsError } = await supabase
            .from('competitor_products')
            .insert(productRows);
          
          if (productsError) {
            console.error('Error inserting competitor products:', productsError);
          } else {
            console.log(`✓ Inserted ${products.length} products into competitor_products`);
          }
          
          // Calculate aggregates for backward compatibility
          const prices = products.map(p => p.price);
          const lowest = Math.min(...prices);
          const highest = Math.max(...prices);
          const average = prices.reduce((a, b) => a + b, 0) / prices.length;
          
          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: marketplaceKey,
            lowest_price: lowest,
            average_price: average,
            highest_price: highest,
            currency: baseline.currency,
            products_found: products.length,
            fetch_status: 'success'
          });
          
          results.push({
            marketplace: config.name,
            status: 'success',
            products_found: products.length,
            lowest,
            average,
            highest
          });
          
          console.log(`✓ ${products.length} products: ${lowest.toFixed(2)}-${highest.toFixed(2)} ${baseline.currency}`);
        } else {
          // Track failed marketplace
          failedMarketplaces.push(marketplaceKey);
          
          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: marketplaceKey,
            currency: baseline.currency,
            fetch_status: 'no_data'
          });
          
          results.push({
            marketplace: config.name,
            status: 'no_data'
          });
          
          console.log(`✗ No matching products - added to failed list`);
        }
        
        // Rate limit between marketplaces
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (error: any) {
        console.error(`Error with ${marketplaceKey}:`, error);
        
        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id: baseline.merchant_id,
          marketplace: marketplaceKey,
          currency: baseline.currency,
          fetch_status: 'failed'
        });
        
        results.push({
          marketplace: marketplaceKey,
          status: 'failed',
          error: error?.message || 'Unknown error'
        });
      }
    }

    // GOOGLE FALLBACK: Trigger if ANY marketplace failed OR no products found OR low confidence
    const shouldUseGoogleFallback = !foundValidProducts || failedMarketplaces.length > 0 || lowConfidenceProducts.length > 0;
    
    if (shouldUseGoogleFallback) {
      console.log('\n=== GOOGLE FALLBACK TRIGGERED ===');
      if (!foundValidProducts) {
        console.log('Reason: No products found across all marketplaces');
      } else if (failedMarketplaces.length > 0) {
        console.log(`Reason: ${failedMarketplaces.length} marketplace(s) failed: ${failedMarketplaces.join(', ')}`);
      } else {
        console.log(`Reason: ${lowConfidenceProducts.length} low confidence products`);
      }
      
      try {
        const googleConfig = MARKETPLACE_CONFIGS['google-shopping'];
        let googleProducts = await scrapeMarketplacePrices(
          googleConfig,
          coreProductName,
          baseline.product_name,
          baseline.current_price,
          baseline.currency
        );
        
        // Filter out wholesale/B2B sites
        const excludedDomains = ['alibaba.com', 'aliexpress.com', 'dhgate.com', 'made-in-china.com', '1688.com'];
        googleProducts = googleProducts.filter(product => {
          const url = product.url?.toLowerCase() || '';
          const hasExcludedDomain = excludedDomains.some(domain => url.includes(domain));
          if (hasExcludedDomain) {
            console.log(`⏭️ Filtered wholesale site: ${url}`);
          }
          return !hasExcludedDomain;
        });
        
        // Apply accessory filtering
        if (!baselineIsAccessory && googleProducts.length > 0) {
          const beforeFilter = googleProducts.length;
          googleProducts = googleProducts.filter(product => !isAccessoryOrReplacement(product.name));
          console.log(`🔍 Google filtering: ${beforeFilter} → ${googleProducts.length} products`);
        }
        
        if (googleProducts.length > 0) {
          const productRows = googleProducts.map((product, index) => ({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: 'google-shopping',
            product_name: product.name,
            price: product.price,
            similarity_score: product.similarity,
            price_ratio: product.priceRatio,
            product_url: product.url,
            currency: baseline.currency,
            rank: index + 1
          }));
          
          await supabase.from('competitor_products').insert(productRows);
          
          const prices = googleProducts.map(p => p.price);
          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: 'google-shopping',
            lowest_price: Math.min(...prices),
            average_price: prices.reduce((a, b) => a + b, 0) / prices.length,
            highest_price: Math.max(...prices),
            currency: baseline.currency,
            products_found: googleProducts.length,
            fetch_status: 'success'
          });
          
          results.push({
            marketplace: 'Google Shopping (Fallback)',
            status: 'success',
            products_found: googleProducts.length
          });
          
          console.log(`✓ Google fallback found ${googleProducts.length} products`);
        } else {
          // Add to manual review queue
          await supabase.from('manual_review_queue').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            product_name: baseline.product_name,
            attempted_marketplaces: [...marketplaceKeys, 'google-shopping'],
            google_fallback_attempted: true,
            status: 'pending'
          });
          
          console.log('⚠️ Added to manual review queue');
        }
      } catch (error) {
        console.error('Google fallback error:', error);
      }
    }

    return new Response(
      JSON.stringify({ success: true, baseline_id, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Internal] Refresh-competitors error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to refresh competitor prices' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
