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
// TIMEOUT CONFIGURATION
// ========================================
const MARKETPLACE_TIMEOUT = 25000; // 25 seconds per marketplace (reduced from 40s)

// ========================================
// CACHE CONFIGURATION
// ========================================
const CACHE_THRESHOLD = 10; // If we have >= 10 cached products, use Google-only for gap-fill
const CACHE_MAX_AGE_DAYS = 15; // Only use cache from last 15 days
const CACHE_MIN_SIMILARITY = 0.80; // Product name similarity threshold for cache matching

// ========================================
// SMART QUERY CONSTRUCTION (NOISE FILTERING)
// ========================================

// Universal noise words that indicate accessories/parts (not main products)
const NOISE_WORDS = [
  // Protection & Storage
  'case', 'cover', 'sleeve', 'pouch', 'skin', 'protector', 'guard', 'film', 'glass', 'bag',
  // Attachments & Wearables
  'strap', 'band', 'bracelet', 'holder', 'stand', 'mount', 'dock',
  // Power & Connectivity
  'cable', 'wire', 'cord', 'charger', 'adapter', 'plug', 'battery',
  // Parts & Consumables
  'part', 'spare', 'replacement', 'bit', 'blade', 'refill', 'sample', 'empty', 'box',
  // Fake/Toy
  'toy', 'replica', 'dummy', 'miniature', 'sticker', 'decal'
];

// Quality filters to exclude used/damaged products
const QUALITY_FILTERS = ['used', 'refurbished', 'broken', 'repair', 'damaged', 'faulty', 'renewed'];

/**
 * Build a smart search query with negative keywords
 * Self-aware: only excludes noise words NOT in the product name
 */
function buildSearchQuery(productName: string, isRefurbished: boolean = false): string {
  const lowerName = productName.toLowerCase();
  const exclusions: string[] = [];
  
  // Add negative keywords for noise words NOT in product name
  for (const word of NOISE_WORDS) {
    if (!lowerName.includes(word)) {
      exclusions.push(`-${word}`);
    }
  }
  
  // Add quality filters (unless user explicitly sells refurbished)
  if (!isRefurbished) {
    for (const filter of QUALITY_FILTERS) {
      if (!lowerName.includes(filter)) {
        exclusions.push(`-${filter}`);
      }
    }
  }
  
  // Limit to ~20 exclusions to avoid query length issues
  const limitedExclusions = exclusions.slice(0, 20);
  
  const smartQuery = `${productName} ${limitedExclusions.join(' ')}`;
  console.log(`🔧 Smart query built: "${productName}" → ${limitedExclusions.length} exclusions`);
  
  return smartQuery;
}

/**
 * FIX 2: Simplify product title for direct marketplace searches
 * Extracts Brand + Model + Storage only
 * "Samsung Galaxy S24 Ultra, AI Phone, 256GB, Titanium Black" → "Samsung Galaxy S24 Ultra 256GB"
 */
function simplifyTitle(fullName: string): string {
  // Noise patterns to remove
  const noisePatterns = [
    /,\s*/g,                           // Remove commas
    /\bAI Phone\b/gi,                  // AI marketing terms
    /\b(Titanium|Black|White|Blue|Green|Purple|Pink|Gold|Silver|Gray|Grey)\b/gi, // Colors
    /\b(Unlocked|Factory Sealed|New|Sealed|Brand New)\b/gi, // Condition
    /\b(Free Shipping|Fast Delivery|Same Day)\b/gi, // Shipping
    /\b(International|US|EU|UK|KSA)\s*(Version|Variant)?\b/gi, // Region
    /\([^)]*\)/g,                      // Remove parenthetical content
    /\[[^\]]*\]/g,                     // Remove bracketed content
  ];
  
  let cleaned = fullName;
  for (const pattern of noisePatterns) {
    cleaned = cleaned.replace(pattern, ' ');
  }
  
  // Keep Brand + Model + Storage (first 6 meaningful words)
  const simplified = cleaned
    .split(/\s+/)
    .filter(word => word.length > 1)
    .slice(0, 6)
    .join(' ')
    .trim();
  
  return simplified;
}

/**
 * Normalize store names from Google results to marketplace keys
 * Known stores merge with direct scraping results, others keep original name
 */
function normalizeStoreToMarketplace(storeName: string | undefined): string {
  if (!storeName || storeName === 'Unknown' || storeName === 'Google') {
    return 'Unknown Store';
  }
  
  const lower = storeName.toLowerCase();
  
  // Map to our known marketplace keys (merge with direct scraping)
  if (lower.includes('amazon')) return 'amazon';
  if (lower.includes('noon')) return 'noon';
  if (lower.includes('extra') && !lower.includes('extrastore')) return 'extra';
  if (lower.includes('jarir')) return 'jarir';
  
  // Keep original store name for stores we don't scrape directly
  // e.g., "Pricena" stays "Pricena", "MobileShop" stays "MobileShop"
  return storeName;
}

// ========================================
// FLOOR RULE VALIDATION (FIX 4)
// ========================================

/**
 * Validate if a scraped price is reasonable
 * Rejects suspiciously low prices (likely extraction errors)
 */
function isValidPrice(scrapedPrice: number, baselinePrice: number, costPrice?: number): boolean {
  // Floor Rule: Price cannot be less than 50% of cost (if cost is available)
  if (costPrice && costPrice > 0 && scrapedPrice < costPrice * 0.5) {
    console.log(`   ⏭️ Floor Rule: ${scrapedPrice} < ${(costPrice * 0.5).toFixed(0)} (50% of cost ${costPrice})`);
    return false;
  }
  
  // Sanity: Price cannot be less than 10% of baseline (likely extraction error like "256")
  if (scrapedPrice < baselinePrice * 0.10) {
    console.log(`   ⏭️ Sanity: ${scrapedPrice} < ${(baselinePrice * 0.10).toFixed(0)} (10% of baseline ${baselinePrice})`);
    return false;
  }
  
  return true;
}

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
  // FIX 3: Price-based wait_for selectors per marketplace
  waitForSelector?: string;
  // FIX 3: Enable stealth proxy for sites that block scrapers
  useStealthProxy?: boolean;
  // FIX 1: Enable Google-First discovery for sites that block direct search scraping
  useGoogleFirstDiscovery?: boolean;
}

// ========================================
// UNIVERSAL JSON-LD EXTRACTION (Priority 1 for product pages)
// ========================================

interface UniversalProductData {
  name?: string;
  price?: number;
  currency?: string;
  availability?: string;
  extractionMethod: string;
}

/**
 * Universal data extractor using JSON-LD and OpenGraph
 * Works on ANY e-commerce site that follows structured data standards
 * Priority 1: JSON-LD (most reliable, standardized)
 * Priority 2: OpenGraph meta tags
 * Returns null if neither found → triggers fallback to CSS selectors
 */
function extractUniversalData(html: string): UniversalProductData | null {
  // ========================================
  // Priority 1: JSON-LD structured data
  // ========================================
  const jsonLdMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  
  if (jsonLdMatches) {
    for (const match of jsonLdMatches) {
      try {
        const jsonContent = match.replace(/<script[^>]*>|<\/script>/gi, '').trim();
        const data = JSON.parse(jsonContent);
        
        // Handle @type: Product directly
        if (data['@type'] === 'Product') {
          const offers = data.offers;
          const price = offers?.price || offers?.[0]?.price || offers?.lowPrice;
          const currency = offers?.priceCurrency || offers?.[0]?.priceCurrency || 'SAR';
          
          if (data.name && price && !isNaN(parseFloat(price))) {
            console.log(`   ✅ JSON-LD found: "${data.name?.slice(0, 50)}..." @ ${price} ${currency}`);
            return {
              name: data.name,
              price: parseFloat(price),
              currency: currency,
              availability: offers?.availability,
              extractionMethod: 'JSON-LD @type:Product'
            };
          }
        }
        
        // Handle @graph array (common in WordPress/WooCommerce)
        if (data['@graph'] && Array.isArray(data['@graph'])) {
          const product = data['@graph'].find((g: any) => g['@type'] === 'Product');
          if (product) {
            const offers = product.offers;
            const price = offers?.price || offers?.[0]?.price || offers?.lowPrice;
            const currency = offers?.priceCurrency || offers?.[0]?.priceCurrency || 'SAR';
            
            if (product.name && price && !isNaN(parseFloat(price))) {
              console.log(`   ✅ JSON-LD @graph found: "${product.name?.slice(0, 50)}..." @ ${price} ${currency}`);
              return {
                name: product.name,
                price: parseFloat(price),
                currency: currency,
                availability: offers?.availability,
                extractionMethod: 'JSON-LD @graph'
              };
            }
          }
        }
        
        // Handle array of items
        if (Array.isArray(data)) {
          const product = data.find((item: any) => item['@type'] === 'Product');
          if (product) {
            const offers = product.offers;
            const price = offers?.price || offers?.[0]?.price || offers?.lowPrice;
            const currency = offers?.priceCurrency || offers?.[0]?.priceCurrency || 'SAR';
            
            if (product.name && price && !isNaN(parseFloat(price))) {
              console.log(`   ✅ JSON-LD array found: "${product.name?.slice(0, 50)}..." @ ${price} ${currency}`);
              return {
                name: product.name,
                price: parseFloat(price),
                currency: currency,
                availability: offers?.availability,
                extractionMethod: 'JSON-LD array'
              };
            }
          }
        }
        
      } catch (e) {
        // Continue to next JSON-LD script
      }
    }
  }
  
  // ========================================
  // Priority 2: OpenGraph meta tags
  // ========================================
  const ogPriceMatch = html.match(/<meta[^>]*property=["'](?:og:price:amount|product:price:amount)["'][^>]*content=["']([^"']+)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:price:amount|product:price:amount)["']/i);
  
  if (ogPriceMatch) {
    const ogCurrencyMatch = html.match(/<meta[^>]*property=["'](?:og:price:currency|product:price:currency)["'][^>]*content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["'](?:og:price:currency|product:price:currency)["']/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) ||
                         html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    
    const price = parseFloat(ogPriceMatch[1].replace(/,/g, ''));
    
    if (!isNaN(price) && price > 0) {
      console.log(`   ✅ OpenGraph found: "${ogTitleMatch?.[1]?.slice(0, 50) || 'Unknown'}..." @ ${price} ${ogCurrencyMatch?.[1] || 'SAR'}`);
      return {
        name: ogTitleMatch?.[1],
        price: price,
        currency: ogCurrencyMatch?.[1] || 'SAR',
        extractionMethod: 'OpenGraph meta'
      };
    }
  }
  
  // No structured data found
  console.log(`   ⚠️ No JSON-LD or OpenGraph data found, falling back to CSS selectors`);
  return null;
}

const MARKETPLACE_CONFIGS: Record<string, MarketplaceConfig> = {
  'google-shopping': {
    name: 'Google Shopping',
    searchUrl: 'https://www.google.com/search?tbm=shop&q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 7000, // Increased wait time for dynamic content
      blockResources: false, // Don't block resources for better rendering
      blockAds: true,
      countryCode: 'us'
    },
    selectors: {
      // FIX 3: ROBUST structural selectors - prioritize stable data attributes over class names
      containers: [
        // Primary structural selectors (most stable - data attributes)
        '[data-pcu]',                           // Google product card unit
        'div[data-docid]',                      // Product with document ID
        'div[jsdata]',                          // Dynamic content containers
        'div[data-async-context]',              // Async product cards
        'div[data-ved]',                        // Google tracking data attribute
        'div[data-idx]',                        // Index-based product containers
        // Shopping-specific patterns
        'div.sh-dgr__grid-result',              // Shopping grid items
        'div.sh-dlr__list-result',              // Shopping list items
        '.sh-dgr__content',                     // Shopping content container
        'div[data-sh-pr]',                      // Shopping product container
        '.sh-pr__product-results-grid > div',   // Direct children of results grid
        // Semantic HTML patterns (stable)
        'article[data-docid]',                  // Article with product ID
        'section[data-idx]',                    // Section with index
        // Fallback structural patterns
        'div:has(h3):has(span[aria-label])',    // Has heading and price aria-label
        'div:has([role="heading"]):has(a[href*="url?q="])', // Has heading and shopping link
        'div:has(h3):has(b)'                    // Has heading and bold (price)
      ],
      productName: [
        // Semantic/accessibility selectors (stable)
        '[role="heading"]',
        'h3',
        'h4',
        'a[aria-label]',                        // Title in link aria-label
        // Data attribute selectors
        '[data-snhf="0"]',                      // Google product title marker
        '[data-name]',                          // Name data attribute
        // Structural patterns
        'a > div:first-child',                  // First div in link
        'a[href*="url?q="] > *:first-child',    // First child of shopping link
        // Class-based fallbacks (may break)
        '.sh-np__product-title',
        '[class*="title"]'
      ],
      price: [
        // FIX 3: Currency-aware aria-label selectors (most reliable)
        'span[aria-label*="SAR"]',
        'span[aria-label*="ريال"]',
        'span[aria-label*="SR "]',
        'span[aria-label*="price"]',
        'span[aria-label*="$"]',
        // Data attribute selectors
        '[data-price]',
        '[data-value]',
        // Structural patterns (stable)
        'span > b',                             // Bold inside span (common for price)
        'div > b:first-child',                  // First bold in div
        'b:first-of-type',                      // First bold element
        // Shopping-specific classes (may change)
        '.a8Pemb',
        '.kHxwFf',
        'span[class*="price"]',
        // Last resort
        'b'
      ]
    },
    waitForSelector: 'h3,div[data-docid],[data-pcu],div[jsdata],[role="heading"],div[data-ved]',
    useStealthProxy: true
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
    },
    // FIX 1: Wait for main search container AND stealth for Saudi site
    waitForSelector: '#search,.s-result-list,.s-main-slot,.a-price',
    useStealthProxy: true
  },
  'noon': {
    name: 'Noon',
    searchUrl: 'https://www.noon.com/saudi-en/search?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 7000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    // FIX: Enable Google-First Discovery for Noon (direct search often times out)
    useGoogleFirstDiscovery: true,
    useStealthProxy: true,
    selectors: {
      containers: [
        'div[data-qa="product-card"]',
        'div[class*="productCard"]',
        'div[class*="ProductCard_"]',
        '[data-testid="search-product-item"]',
        'div[data-component="ProductBox"]',
        'div[data-qa-id="grid-view-item"]',
        'article[data-component]',
        '[data-qa="product-tile"]',
        'div.productContainer',
        'article[data-qa="product-tile"]',
        '.grid > div[class*="product"]',
        'div[class*="ProductBox"]',
        'div[data-qa="product-item"]',
        'a[href*="/product/"]',
        'div:has(a[href*="/product/"]):has([class*="price"])',
        'article'
      ],
      productName: [
        '[data-qa="product-title"]',
        'span[class*="productTitle"]',
        'h2[class*="title"]',
        '[data-qa="product-name"]',
        'div[class*="productTitle"]',
        'h3[class*="productTitle"]',
        'span[data-qa="product-name"]',
        '[class*="title"]',
        '.productContainer h2',
        'a[href*="/product/"] span',
        'div > a:first-child',
        'h2', 'h3', 'h4',
        '[class*="name"]'
      ],
      price: [
        '[data-qa="product-price"] span',
        'span[class*="priceNow"]',
        'span[class*="Price_now"]',
        'strong[class*="amount"]',
        '[data-qa="product-price"]',
        'div[class*="price"] strong',
        'span[class*="price"]',
        '[class*="priceNow"]',
        '[class*="price"] span:first-child',
        'strong',
        '.sellingPrice'
      ]
    },
    // FIX 3: Wait for PRICE elements, not just containers
    waitForSelector: '[data-qa="product-price"],.priceNow,[class*="price"],[class*="Price"]'
  },
  'extra': {
    name: 'Extra',
    searchUrl: 'https://www.extra.com/en-sa/search?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 8000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        'div[data-qa="product-tile"]',
        'div.product-tile',
        'div[class*="ProductTile_"]',
        '.product-list div[class*="product"]',
        'div[data-testid="search-result-item"]',
        'div[data-product-code]',
        'div.product-listing__item',
        'div[class*="product-list-item"]',
        'article.product-item',
        'div[data-testid="plp-prod-item"]',
        '.product-grid-item',
        'div[class*="ProductCard"]',
        'div[class*="ProductTile"]',
        'div[data-testid="product-tile"]',
        'article[class*="product"]',
        'li[class*="product"]',
        'div.product-item',
        'div.product-card',
        'a[href*="/product/"]',
        'div:has(a[href]):has([class*="price"])'
      ],
      productName: [
        '[data-qa="product-name"]',
        'a[data-testid="product-name"]',
        'div[class*="product-name"] a',
        '.product-listing__title',
        '[data-testid="product-title"]',
        'a[class*="product-title"]',
        'h3[class*="ProductTitle"]',
        '.product-card__title',
        'h3[class*="title"]',
        'a[class*="title"]',
        'div[class*="productName"]',
        'h3 a',
        '.product-title',
        '.product-name',
        'a[href*="/product/"]',
        'h2 a', 'h3 a',
        '[class*="title"] a',
        '[class*="name"]'
      ],
      price: [
        // FIX 2: Extra.com uses SVG for currency - focus on number patterns near VAT text
        '[data-qa="product-price"]',
        '.c_product-price',              // Extra's current price class
        '.product-price__value',         // Price value container
        'span[data-testid="product-price"]',
        '.product-listing__price span',
        'span[class*="price--current"]',
        '[data-testid="product-price"]',
        'span[class*="Price"]',
        '.product-price',
        'span[class*="final-price"]',
        'span[class*="price"]',
        'div[class*="price"] span',
        'span[class*="amount"]',
        'strong[class*="price"]',
        '.price',
        '.special-price',
        '.final-price',
        '[class*="price"]:not([class*="was"])',
        'strong'
      ]
    },
    // FIX 3: Wait for PRICE elements - add Extra-specific selectors
    waitForSelector: '.product-price,.c_product-price,.price-box,[class*="Price"],[data-qa="product-price"],.product-price__value',
    useStealthProxy: true, // Saudi site - enable stealth
    // FIX 1: Enable Google-First discovery for Extra (search pages are blocked)
    useGoogleFirstDiscovery: true
  },
  'jarir': {
    name: 'Jarir',
    searchUrl: 'https://www.jarir.com/sa-en/catalogsearch/result/?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000, // Increased wait time
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        // Magento-specific selectors
        '.product-items .product-item',
        '.products.list .product-item',
        'li.product-item',
        'div.product-item-info',
        'div.products-grid .item',
        'ol.products.list .item',
        'div[data-product-sku]',
        'article.product',
        // Jarir-specific selectors
        '.product-card',
        '.product-listing-item',
        '[data-product-id]',
        'a[href*="/product/"]',
        'div:has(a[href]):has(.price)',
        'div[class*="product"]'
      ],
      productName: [
        '.product-item-info .product-item-link',
        'a.product-item-link',
        '.product-item-name a',
        '.product.name a',
        'h2.product-name a',
        'span.product-item-link',
        'a[class*="product-name"]',
        '.product-title',
        '.product-card__title',
        'a[href*="/product/"]',
        'h2 a', 'h3 a',
        'h1' // Product detail page
      ],
      price: [
        // Magento price selectors
        '.price-box .price',
        'span[data-price-amount]',
        '[data-price-type="finalPrice"] .price',
        '.price-wrapper .price',
        '.price-final_price .price',
        'span.price',
        'span[class*="price-value"]',
        'div.price-box span.price',
        'span[data-price-type="finalPrice"]',
        'span.special-price span.price',
        '.final-price',
        '.sale-price',
        // Jarir-specific selectors
        '.product-price',
        '.product-info-price .price',
        '[class*="price"] span',
        'strong'
      ]
    },
    // FIX 3: Wait for Magento price elements with more options
    waitForSelector: '.price-box .price,span[data-price-amount],[data-price-type="finalPrice"],.product-price,.product-info-price',
    useStealthProxy: true, // Saudi site - enable stealth
    // FIX 1: Enable Google-First discovery for Jarir (search pages often fail)
    useGoogleFirstDiscovery: true
  },
  'amazon-us': {
    name: 'Amazon.com',
    searchUrl: 'https://www.amazon.com/s?k=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 3000,
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
      wait: 3500,
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
      wait: 3000,
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
      wait: 3500,
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

function extractPrice(text: string, expectedCurrency: string, productName?: string): { price: number; confidence: number } | null {
  if (!text) return null;
  
  text = text.replace(/from|as low as|starting at|save|off|each|per|month|\/mo/gi, '').trim();
  
  // FIX 1: Extract storage sizes from product name to exclude from price extraction
  const storageSizesToExclude: Set<string> = new Set();
  const modelNumbersToExclude: Set<string> = new Set();
  
  if (productName) {
    // Extract storage sizes (256GB, 512GB, 1TB, etc.)
    const storagePattern = /(\d+)\s*(?:GB|TB)/gi;
    let storageMatch;
    while ((storageMatch = storagePattern.exec(productName)) !== null) {
      storageSizesToExclude.add(storageMatch[1]);
    }
    
    // Extract model numbers (e.g., "16" from "iPhone 16", "24" from "S24")
    const modelPatterns = [
      /iphone\s*(\d+)/gi,
      /galaxy\s*[sza]?(\d+)/gi,
      /pixel\s*(\d+)/gi,
      /(\d+)\s*(?:pro|max|mini|plus|ultra)/gi,
    ];
    
    for (const pattern of modelPatterns) {
      let match;
      while ((match = pattern.exec(productName)) !== null) {
        modelNumbersToExclude.add(match[1]);
      }
    }
  }
  
  const patterns = [
    // NEW: VAT indicator (common on Extra.com with SVG currency symbols)
    /(\d{1,3}(?:,\d{3})*\.?\d*)\s*(?:Incl\.?\s*VAT|VAT)/i,
    // SAR patterns with ﷼ symbol
    /(?:SAR|SR|ریال|ر\.س\.?|﷼)\s*([0-9,]+\.?[0-9]*)/i,
    /([0-9,]+\.?[0-9]*)\s*(?:SAR|SR|ریال|ر\.س\.?|﷼)/i,
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
      
      // Skip if this number is a storage size
      if (storageSizesToExclude.has(priceStr)) {
        continue;
      }
      
      // Skip if this number is a model number
      if (modelNumbersToExclude.has(priceStr)) {
        continue;
      }
      
      // Skip very small numbers that are likely not prices
      if (price < 50) {
        continue;
      }
      
      if (!isNaN(price) && price > 0) {
        let confidence = 1.0 - (i * 0.1);
        
        if (expectedCurrency === 'SAR' && match[0].match(/SAR|SR|ریال|ر\.س|﷼|Incl\.?\s*VAT/i)) {
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
 */
function isAccessoryOrReplacement(productName: string): boolean {
  const accessoryKeywords = [
    'replacement', 'replace', 'spare', 'parts',
    'earpads', 'ear pads', 'ear pad', 'cushion', 'cushions', 'foam', 'tips',
    'case', 'cover', 'protective', 'pouch', 'bag', 'hard case', 'soft case',
    'cable', 'cord', 'wire', 'adapter', 'charger', 'charging cable',
    'screen protector', 'protector', 'tempered glass', 'glass film', 'film',
    'lens protector', 'camera protector', 'privacy screen',
    'screen guard', 'guard', 'shield',
    'stand', 'mount', 'holder', 'strap', 'skin', 'sticker', 'decal',
    'pcs', 'pieces', 'pair', 'set of', 'pack of', 
    '2 pack', '3 pack', '4 pack', '2-pack', '3-pack', '4-pack',
    '2pcs', '3pcs', '4pcs',
    'قطع غيار', 'قطع', 'غيار', 'بديل', 'حافظة', 'كفر', 'غطاء', 'وسادة', 'كابل'
  ];
  
  const lowerName = productName.toLowerCase();
  return accessoryKeywords.some(keyword => lowerName.includes(keyword));
}

// ========================================
// MODEL NUMBER VALIDATION FOR ELECTRONICS
// ========================================

/**
 * Extract model information from product name
 */
function extractModelInfo(productName: string): { 
  brand: string; 
  model: string; 
  version: number | null 
} {
  const lowerName = productName.toLowerCase();
  
  // iPhone Air detection FIRST
  if (lowerName.includes('iphone air')) {
    return {
      brand: 'iphone-air',
      model: 'air',
      version: null
    };
  }
  
  // iPhone detection
  const iphoneMatch = lowerName.match(/iphone\s*(\d+)\s*(pro\s*max|pro|plus|mini)?/i);
  if (iphoneMatch) {
    return {
      brand: 'iphone',
      model: (iphoneMatch[2] || 'standard').toLowerCase().replace(/\s+/g, ' ').trim(),
      version: parseInt(iphoneMatch[1])
    };
  }
  
  // Samsung Galaxy detection
  const galaxyMatch = lowerName.match(/galaxy\s*([sza])(\d+)\s*(ultra|plus|fe)?/i);
  if (galaxyMatch) {
    return {
      brand: 'galaxy',
      model: `${galaxyMatch[1]}${galaxyMatch[3] || ''}`.toLowerCase().replace(/\s+/g, ' ').trim(),
      version: parseInt(galaxyMatch[2])
    };
  }
  
  return { brand: '', model: '', version: null };
}

/**
 * Extract storage size from product name
 */
function extractStorageSize(productName: string): number | null {
  const storageMatch = productName.match(/(\d+)\s*(?:gb|GB|Gb)/i);
  return storageMatch ? parseInt(storageMatch[1]) : null;
}

/**
 * Check if two products have mismatched model numbers
 */
function isModelMismatch(baselineProduct: string, competitorProduct: string): boolean {
  const baseline = extractModelInfo(baselineProduct);
  const competitor = extractModelInfo(competitorProduct);
  
  // Check brand first
  if (baseline.brand && competitor.brand && baseline.brand !== competitor.brand) {
    return true;
  }
  
  if ((baseline.brand && !competitor.brand) || (!baseline.brand && competitor.brand)) {
    return false;
  }
  
  // If both are iPhones, version must match
  if (baseline.brand === 'iphone' && competitor.brand === 'iphone') {
    if (baseline.version !== null && competitor.version !== null) {
      const versionMatch = baseline.version === competitor.version;
      if (!versionMatch) {
        return true;
      }
    }
    
    if (baseline.model && competitor.model) {
      const baselineModel = baseline.model.replace(/\s+/g, '');
      const competitorModel = competitor.model.replace(/\s+/g, '');
      if (baselineModel !== competitorModel) {
        return true;
      }
    }
  }
  
  // If both are Galaxy phones, version must match
  if (baseline.brand === 'galaxy' && competitor.brand === 'galaxy') {
    if (baseline.version !== null && competitor.version !== null) {
      const versionMatch = baseline.version === competitor.version;
      if (!versionMatch) {
        return true;
      }
    }
    
    if (baseline.model && competitor.model) {
      const baselineModel = baseline.model.replace(/\s+/g, '');
      const competitorModel = competitor.model.replace(/\s+/g, '');
      if (baselineModel !== competitorModel) {
        return true;
      }
    }
  }
  
  return false;
}

// ========================================
// SCRAPING INTERFACES
// ========================================

interface ScrapedProduct {
  name: string;
  price: number;
  similarity: number;
  priceRatio: number;
  url?: string;
  sourceStore?: string;
}

interface ScrapeResult {
  marketplace: string;
  products: ScrapedProduct[];
  status: 'success' | 'no_data' | 'timeout' | 'error';
  elapsed: number;
  error?: string;
}

/**
 * Filters out prices that are 5x lower than the average
 * @param products Array of scraped products
 * @returns Filtered products without outliers
 */
function filterLowestPriceOutliers(products: ScrapedProduct[]): ScrapedProduct[] {
  if (products.length < 2) return products;
  
  // Calculate average price
  const totalPrice = products.reduce((sum, p) => sum + p.price, 0);
  const averagePrice = totalPrice / products.length;
  const threshold = averagePrice / 5;
  
  // Filter out products with price < threshold (5x lower than average)
  const filtered = products.filter(p => {
    if (p.price < threshold) {
      console.log(`   ⚠️ OUTLIER REJECTED: ${p.price} SAR (< ${threshold.toFixed(0)} threshold, avg: ${averagePrice.toFixed(0)})`);
      return false;
    }
    return true;
  });
  
  if (filtered.length < products.length) {
    console.log(`   🧹 Outlier filter: ${products.length} → ${filtered.length} products`);
  }
  
  return filtered;
}

// ========================================
// NON-RETAILER FILTERING
// ========================================

const NON_RETAILER_DOMAINS = [
  'gsmarena.com', 'samsung.com', 'apple.com', 'phonearena.com',
  'techradar.com', 'cnet.com', 'youtube.com', 'wikipedia.org',
  'reddit.com', 'twitter.com', 'facebook.com', 'instagram.com',
  'tiktok.com', 'quora.com', 'alibaba.com', 'aliexpress.com', 'made-in-china.com'
];

function isNonRetailerDomain(url: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return NON_RETAILER_DOMAINS.some(domain => hostname.includes(domain));
  } catch {
    return false;
  }
}

function extractStoreFromUrl(url: string): string {
  if (!url) return 'Unknown';
  
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    
    // Saudi Arabia stores
    if (hostname.includes('noon.com')) return 'Noon';
    if (hostname.includes('extra.com')) return 'Extra';
    if (hostname.includes('jarir.com')) return 'Jarir';
    if (hostname.includes('amazon.sa')) return 'Amazon SA';
    if (hostname.includes('carrefour')) return 'Carrefour';
    if (hostname.includes('lulu')) return 'LuLu';
    if (hostname.includes('panda')) return 'Panda';
    if (hostname.includes('xcite')) return 'X-cite';
    if (hostname.includes('souq')) return 'Souq';
    if (hostname.includes('pricena')) return 'Pricena';
    if (hostname.includes('opensooq')) return 'Opensooq';
    if (hostname.includes('haraj')) return 'Haraj';
    if (hostname.includes('olx')) return 'OLX';
    if (hostname.includes('dubizzle')) return 'Dubizzle';
    if (hostname.includes('sharafdg')) return 'Sharaf DG';
    if (hostname.includes('saco')) return 'SACO';
    if (hostname.includes('virgin')) return 'Virgin Megastore';
    if (hostname.includes('homebox')) return 'Home Box';
    if (hostname.includes('ikea')) return 'IKEA';
    
    // International stores
    if (hostname.includes('amazon.com')) return 'Amazon US';
    if (hostname.includes('walmart.com')) return 'Walmart';
    if (hostname.includes('ebay.com')) return 'eBay';
    if (hostname.includes('target.com')) return 'Target';
    if (hostname.includes('bestbuy.com')) return 'Best Buy';
    if (hostname.includes('newegg.com')) return 'Newegg';
    if (hostname.includes('bhphotovideo.com')) return 'B&H Photo';
    if (hostname.includes('costco')) return 'Costco';
    if (hostname.includes('aliexpress')) return 'AliExpress';
    
    const parts = hostname.replace('www.', '').split('.');
    if (parts.length > 0) {
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
    
    return 'Unknown';
  } catch {
    return 'Unknown';
  }
}

// ========================================
// GOOGLE SCRAPERS
// ========================================

async function scrapeGoogleSERP(
  productName: string,
  baselinePrice: number,
  currency: string,
  baselineFullName: string
): Promise<ScrapedProduct[]> {
  const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  
  if (!scrapingbeeApiKey) {
    console.error('SCRAPINGBEE_API_KEY not configured');
    return [];
  }
  
  console.log(`\n🔍 Google SERP Search (stealth_proxy)`);
  console.log(`   Query: "${productName} price"`);
  
  try {
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(productName + ' price')}`;
    
    const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
    sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
    sbUrl.searchParams.set('url', googleSearchUrl);
    sbUrl.searchParams.set('custom_google', 'true');
    sbUrl.searchParams.set('stealth_proxy', 'true');
    sbUrl.searchParams.set('render_js', 'true');
    sbUrl.searchParams.set('wait', '3000');
    sbUrl.searchParams.set('country_code', currency === 'SAR' ? 'sa' : 'us');
    
    const response = await fetch(sbUrl.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ SERP error: ${response.status} - ${errorText}`);
      return [];
    }
    
    const html = await response.text();
    console.log(`✅ Received ${html.length} chars from Google SERP`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc) return [];
    
    const containers = trySelectAll(doc, [
      'div.tF2Cxc', 'div.g', '[data-hveid]', '.yuRUbf'
    ]);
    
    if (containers.length === 0) {
      const bodySnippet = doc.body?.innerHTML?.substring(0, 500).replace(/\s+/g, ' ') || '';
      console.log(`⚠️ No Google results found. HTML sample: ${bodySnippet}`);
      return [];
    }
    
    console.log(`✓ Found ${containers.length} Google search results`);
    
    const products: ScrapedProduct[] = [];
    const normalizedBaseline = normalizeProductName(baselineFullName);
    
    for (let i = 0; i < Math.min(containers.length, 30); i++) {
      const container = containers[i];
      
      const nameEl = trySelectOne(container, ['h3', '.LC20lb', 'div[role="heading"]']);
      if (!nameEl) continue;
      
      const name = nameEl.textContent?.trim();
      if (!name) continue;
      
      const snippetEl = trySelectOne(container, ['.VwiC3b', '.lEBKkf', 'div[data-content-feature="1"]', 'div.s']);
      const snippet = snippetEl?.textContent?.trim() || '';
      const combinedText = `${name} ${snippet}`;
      
      const extracted = extractPrice(combinedText, currency, baselineFullName);
      if (!extracted || extracted.price <= 0) continue;
      
      // FIX 4: Apply Floor Rule validation
      if (!isValidPrice(extracted.price, baselinePrice)) continue;
      
      const normalizedCompetitor = normalizeProductName(name);
      const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
      const priceRatio = extracted.price / baselinePrice;
      
      let productUrl: string | undefined;
      let sourceStore: string = 'Google Search';
      try {
        const linkEl = container.querySelector('a[href]');
        if (linkEl) {
          const href = linkEl.getAttribute('href');
          if (href) {
            productUrl = href;
            const urlStore = extractStoreFromUrl(href);
            
            // FIX: If URL returns Google, extract from HTML text
            if (urlStore === 'Google' || urlStore === 'Unknown') {
              const containerText = container.textContent || '';
              const fromMatch = containerText.match(/from\s+([A-Za-z][A-Za-z0-9\s\.]+?)(?:\s*[·•\|]|\s*SAR|\s*\$|\s*\d|$)/i);
              if (fromMatch && fromMatch[1]) {
                sourceStore = fromMatch[1].trim();
                console.log(`   📍 SERP store from HTML: "${sourceStore}"`);
              } else {
                sourceStore = urlStore;
              }
            } else {
              sourceStore = urlStore;
            }
            
            if (isNonRetailerDomain(href)) {
              console.log(`   ⏭️ Skipping non-retailer: ${sourceStore}`);
              continue;
            }
          }
        }
      } catch (e) {
        // Ignore
      }
      
      products.push({
        name,
        price: extracted.price,
        similarity,
        priceRatio,
        url: productUrl,
        sourceStore
      });
    }
    
    console.log(`✓ Extracted ${products.length} products from Google SERP`);
    return products.sort((a, b) => b.similarity - a.similarity).slice(0, 30);
    
  } catch (error: any) {
    console.error(`❌ Google SERP error:`, error.message);
    return [];
  }
}

/**
 * TEXT-BASED FALLBACK: Extract price from container text using regex patterns
 * Used when CSS selectors fail due to class name changes
 * FIX 2: Enhanced for Extra.com which uses SVG for currency symbols
 * FIX: Rejects year numbers (2018-2030) that are commonly misextracted as prices
 */
function extractPriceFromContainerText(containerText: string, currency: string): { price: number; method: string } | null {
  if (!containerText) return null;
  
  // Currency-specific patterns for Saudi Arabia
  // FIX 2: Extra.com uses SVG for Saudi Riyal symbol - text appears as "1,710 Incl. VAT" without currency
  const sarPatterns = [
    // HIGHEST PRIORITY: Pattern for Extra.com and sites using SVG currency symbols
    { pattern: /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:Incl\.?\s*VAT|incl\.?\s*vat)/i, name: 'VAT suffix (Extra.com SVG fix)' },
    // Standard SAR patterns
    { pattern: /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:SAR|SR|ر\.س|ريال|﷼)/i, name: 'SAR suffix' },
    { pattern: /(?:SAR|SR|ر\.س|ريال|﷼)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'SAR prefix' },
    // Extra.com specific: Number followed by "VAT" somewhere on the line
    { pattern: /(\d{1,3}(?:,\d{3})*)\s*(?:VAT|vat)/i, name: 'VAT indicator' },
  ];
  
  // USD patterns
  const usdPatterns = [
    { pattern: /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i, name: 'USD symbol' },
    { pattern: /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars?)/i, name: 'USD suffix' },
  ];
  
  // Generic price patterns (last resort)
  const genericPatterns = [
    { pattern: /\b(\d{1,3}(?:,\d{3})*\.\d{2})\b/, name: 'decimal price' },
    { pattern: /\b(\d{4,6})\b/, name: 'large number' }, // 1000-999999 range
  ];
  
  const patterns = currency === 'SAR' 
    ? [...sarPatterns, ...genericPatterns]
    : [...usdPatterns, ...genericPatterns];
  
  for (const { pattern, name } of patterns) {
    const match = containerText.match(pattern);
    if (match && match[1]) {
      const price = parseFloat(match[1].replace(/,/g, ''));
      
      // FIX: Reject year numbers (2018-2030) - common extraction error
      if (price >= 2018 && price <= 2030) {
        console.log(`   ⏭️ Skipping year number: ${price}`);
        continue;
      }
      
      // Validate it's a reasonable price (not storage size like 256, 512)
      if (!isNaN(price) && price >= 100 && price < 100000) {
        console.log(`   💰 Price extracted via ${name}: ${price}`);
        return { price, method: name };
      }
    }
  }
  
  return null;
}

/**
 * TEXT-BASED FALLBACK: Extract product name from container
 * Looks for heading-like text or first substantial text block
 * FIX: Rejects common garbage patterns like "About this result", info dialogs
 */
function extractNameFromContainerText(containerText: string): string | null {
  if (!containerText) return null;
  
  // Garbage patterns to reject - these are NOT product names
  const garbagePatterns = [
    /^about\s+this/i,
    /^learn\s+more/i,
    /^why\s+this/i,
    /^sponsored/i,
    /^ad\s*$/i,
    /^see\s+more/i,
    /^show\s+more/i,
    /^view\s+all/i,
    /^filter/i,
    /^sort\s+by/i,
    /^results?\s+for/i,
    /^shopping/i,
    /^compare/i,
    /^\d+\s+results?/i,
    /^sign\s+in/i,
    /^menu/i,
  ];
  
  // Split by newlines and find first substantial line (likely the title)
  const lines = containerText.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 10 && l.length < 200);
  
  // First line that looks like a product name
  for (const line of lines) {
    // Skip lines starting with numbers (prices/dates)
    if (/^\d/.test(line)) continue;
    // Skip "from store" patterns
    if (/^from\s/i.test(line)) continue;
    // Skip currency prefixes
    if (/^SAR|^SR|^\$/i.test(line)) continue;
    // Skip garbage patterns
    if (garbagePatterns.some(pattern => pattern.test(line))) continue;
    // Skip very short lines or lines that are just numbers
    if (line.length < 15) continue;
    // Must contain at least one letter
    if (!/[a-zA-Z]/.test(line)) continue;
    
    return line;
  }
  
  return null;
}

async function scrapeGoogleShopping(
  productName: string,
  baselinePrice: number,
  currency: string,
  baselineFullName: string
): Promise<ScrapedProduct[]> {
  const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  
  if (!scrapingbeeApiKey) {
    console.error('SCRAPINGBEE_API_KEY not configured');
    return [];
  }
  
  const isRefurbished = productName.toLowerCase().includes('refurbished') || productName.toLowerCase().includes('renewed');
  const smartQuery = buildSearchQuery(productName, isRefurbished);
  
  console.log(`\n🛒 Google Shopping Search (ENHANCED SELECTORS)`);
  console.log(`   Original: "${productName}"`);
  console.log(`   Smart Query: "${smartQuery.slice(0, 100)}..."`);
  
  try {
    const shoppingUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(smartQuery)}`;
    
    const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
    sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
    sbUrl.searchParams.set('url', shoppingUrl);
    sbUrl.searchParams.set('custom_google', 'true');
    sbUrl.searchParams.set('stealth_proxy', 'true');
    sbUrl.searchParams.set('render_js', 'true');
    sbUrl.searchParams.set('wait', '6000'); // Increased wait
    sbUrl.searchParams.set('wait_browser', 'networkidle2'); // Wait for network idle
    sbUrl.searchParams.set('country_code', currency === 'SAR' ? 'sa' : 'us');
    
    const response = await fetch(sbUrl.toString());
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Shopping error: ${response.status} - ${errorText}`);
      return [];
    }
    
    const html = await response.text();
    console.log(`✅ Received ${html.length} chars from Google Shopping`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc) return [];
    
    // ROBUST container selectors - prioritize stable data attributes
    const containerSelectors = [
      '[data-pcu]',                    // Google product card unit (stable)
      'div[data-docid]',               // Product with document ID (stable)
      'div[jsdata]',                   // Dynamic content containers
      'div[data-async-context]',       // Async product cards
      'div.sh-dgr__grid-result',       // Shopping grid items
      'div.sh-dlr__list-result',       // Shopping list items
      '.sh-dgr__content',              // Shopping content container
      'div[data-sh-pr]',               // Shopping product container
    ];
    
    let containers = trySelectAll(doc, containerSelectors);
    
    // FALLBACK: If no containers found, try generic product-like structures
    if (containers.length === 0) {
      console.log(`⚠️ Primary selectors failed, trying generic fallback...`);
      
      // Look for any div that has both a heading (h3/h4) and text containing price
      const allDivs = Array.from(doc.querySelectorAll('div'));
      containers = allDivs.filter((div: any) => {
        const hasHeading = div.querySelector('h3') || div.querySelector('h4') || div.querySelector('[role="heading"]');
        const text = div.textContent || '';
        const hasPrice = /\d{3,6}/.test(text) && (text.includes('SAR') || text.includes('SR') || text.includes('$') || /\d+\.\d{2}/.test(text));
        const hasLink = div.querySelector('a[href]');
        return hasHeading && hasPrice && hasLink;
      }).slice(0, 50); // Limit to prevent too many containers
      
      if (containers.length > 0) {
        console.log(`✅ Fallback found ${containers.length} product-like containers`);
      }
    }
    
    if (containers.length === 0) {
      const bodySnippet = doc.body?.innerHTML?.substring(0, 800).replace(/\s+/g, ' ') || '';
      console.log(`⚠️ No Shopping results found. HTML sample: ${bodySnippet}`);
      
      // Log available data attributes for debugging
      const dataAttrs = new Set<string>();
      doc.querySelectorAll('div[data-*]').forEach((el: any) => {
        Array.from(el.attributes || []).forEach((attr: any) => {
          if (attr.name.startsWith('data-')) dataAttrs.add(attr.name);
        });
      });
      console.log(`   📊 Available data attributes: ${[...dataAttrs].slice(0, 10).join(', ')}`);
      
      return [];
    }
    
    console.log(`✓ Found ${containers.length} Shopping containers`);
    
    // Log first container structure for debugging future selector issues
    if (containers.length > 0) {
      const firstContainer = containers[0] as any;
      const containerHtml = firstContainer.outerHTML?.slice(0, 400) || '';
      console.log(`   📝 First container sample: ${containerHtml.replace(/\s+/g, ' ')}`);
    }
    
    const products: ScrapedProduct[] = [];
    const normalizedBaseline = normalizeProductName(baselineFullName);
    
    // ROBUST title selectors
    const titleSelectors = [
      'h3',
      'h4',
      '[role="heading"]',
      'a[aria-label]',
      '[data-snhf="0"]',
      'a > div:first-child',
      '.sh-np__product-title',
    ];
    
    // ROBUST price selectors with currency awareness
    const priceSelectors = [
      'span[aria-label*="SAR"]',
      'span[aria-label*="ريال"]',
      'span[aria-label*="price"]',
      'span[aria-label*="$"]',
      'span > b',
      'div > b',
      'b:first-of-type',
      '[data-price]',
      '.a8Pemb',
      'span[class*="price"]',
      'b',
    ];
    
    for (let i = 0; i < Math.min(containers.length, 40); i++) {
      const container = containers[i] as any;
      const containerText = container.textContent || '';
      
    // TRY 1: CSS Selector-based extraction
      let name: string | null = null;
      const nameEl = trySelectOne(container, titleSelectors);
      if (nameEl) {
        const rawName = nameEl.textContent?.trim() || nameEl.getAttribute?.('aria-label')?.trim();
        // FIX: Validate extracted name is not garbage
        if (rawName && rawName.length > 10 && !/^about\s+this/i.test(rawName) && !/^learn\s+more/i.test(rawName)) {
          name = rawName;
        }
      }
      
      // TRY 2: Text-based fallback for name (uses improved validation)
      if (!name) {
        name = extractNameFromContainerText(containerText);
        if (name) console.log(`   📝 Text fallback name: "${name.slice(0, 50)}..."`);
      }
      
      if (!name) continue;
      
      // TRY 1: CSS Selector-based price extraction
      let extractedPrice: { price: number; confidence: number } | null = null;
      const priceEl = trySelectOne(container, priceSelectors);
      if (priceEl) {
        const priceText = priceEl.textContent?.trim() || priceEl.getAttribute?.('aria-label')?.trim();
        if (priceText) {
          extractedPrice = extractPrice(priceText, currency, baselineFullName);
        }
      }
      
      // TRY 2: Text-based fallback for price
      if (!extractedPrice || extractedPrice.price <= 0) {
        const textPrice = extractPriceFromContainerText(containerText, currency);
        if (textPrice) {
          extractedPrice = { price: textPrice.price, confidence: 0.7 };
          console.log(`   💰 Text fallback price: ${textPrice.price} (${textPrice.method})`);
        }
      }
      
      if (!extractedPrice || extractedPrice.price <= 0) continue;
      
      // Apply Floor Rule validation
      if (!isValidPrice(extractedPrice.price, baselinePrice)) continue;
      
      const normalizedCompetitor = normalizeProductName(name);
      const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
      const priceRatio = extractedPrice.price / baselinePrice;
      
      let productUrl: string | undefined;
      let sourceStore: string = 'Google Shopping';
      try {
        const linkEl = container.querySelector('a[href]');
        if (linkEl) {
          const href = linkEl.getAttribute('href');
          if (href) {
            const fullUrl = href.startsWith('http') ? href : `https://www.google.com${href}`;
            productUrl = fullUrl;
            
            const urlStore = extractStoreFromUrl(fullUrl);
            
            if (urlStore === 'Google' || urlStore === 'Unknown') {
              // Extract store from container text
              const fromMatch = containerText.match(/from\s+([A-Za-z][A-Za-z0-9\s\.]+?)(?:\s*[·•\|]|\s*SAR|\s*\$|\s*\d|$)/i);
              if (fromMatch && fromMatch[1]) {
                sourceStore = fromMatch[1].trim();
              } else {
                const sellerMatch = containerText.match(/(?:sold by|seller|merchant|shop)[\s:]+([A-Za-z][A-Za-z0-9\s\.]+?)(?:\s*[·•\|]|\s*SAR|\s*\$|\s*\d|$)/i);
                if (sellerMatch && sellerMatch[1]) {
                  sourceStore = sellerMatch[1].trim();
                }
              }
            } else {
              sourceStore = urlStore;
            }
            
            if (isNonRetailerDomain(fullUrl)) {
              console.log(`   ⏭️ Skipping non-retailer: ${sourceStore}`);
              continue;
            }
          }
        }
      } catch (e) {
        // Ignore
      }
      
      products.push({
        name,
        price: extractedPrice.price,
        similarity,
        priceRatio,
        url: productUrl,
        sourceStore
      });
    }
    
    console.log(`✓ Extracted ${products.length} products from Google Shopping`);
    
    // Log extraction stats for debugging
    if (products.length > 0) {
      const stores = [...new Set(products.map(p => p.sourceStore))];
      console.log(`   📊 Stores found: ${stores.join(', ')}`);
      console.log(`   💰 Price range: ${Math.min(...products.map(p => p.price))} - ${Math.max(...products.map(p => p.price))} ${currency}`);
    }
    
    return products.sort((a, b) => b.similarity - a.similarity).slice(0, 35);
    
  } catch (error: any) {
    console.error(`❌ Google Shopping error:`, error.message);
    return [];
  }
}

// ========================================
// MARKETPLACE SCRAPER
// ========================================

async function scrapeMarketplacePrices(
  config: MarketplaceConfig,
  productName: string,
  fullProductName: string,
  baselinePrice: number,
  currency: string,
  costPrice?: number
): Promise<ScrapedProduct[]> {
  const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  
  if (!scrapingbeeApiKey) {
    console.error('SCRAPINGBEE_API_KEY not configured');
    return [];
  }
  
  // FIX 2: Use simplified title for direct marketplace searches
  const simplifiedName = simplifyTitle(productName);
  
  // Limit query variations to 2 for speed
  const searchQueries: string[] = [];
  searchQueries.push(simplifiedName);
  
  // For iPhones: try without storage size
  const lowerName = productName.toLowerCase();
  if (lowerName.includes('iphone')) {
    const withoutStorage = simplifiedName.replace(/\s*\d+\s*(?:gb|GB|tb|TB)/gi, '').trim();
    if (withoutStorage !== simplifiedName) {
      searchQueries.push(withoutStorage);
    }
  } else {
    // Shorter version for non-iPhones
    const shorterQuery = simplifiedName.split(' ').slice(0, 4).join(' ');
    if (shorterQuery !== simplifiedName) {
      searchQueries.push(shorterQuery);
    }
  }
  
  const limitedQueries = searchQueries.slice(0, 2);
  
  console.log(`\n🐝 Scraping ${config.name} (${limitedQueries.length} queries)`);
  
  let allProducts: ScrapedProduct[] = [];
  
  for (let queryIndex = 0; queryIndex < limitedQueries.length; queryIndex++) {
    const query = limitedQueries[queryIndex];
    const searchUrl = config.searchUrl + encodeURIComponent(query);
    
    if (queryIndex > 0) {
      console.log(`   📝 Trying variation ${queryIndex + 1}: "${query}"`);
    } else {
      console.log(`   URL: ${searchUrl}`);
    }
    
    try {
      const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
      sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
      sbUrl.searchParams.set('url', searchUrl);
      sbUrl.searchParams.set('render_js', String(config.scrapingBeeOptions.renderJs));
      sbUrl.searchParams.set('wait', String(config.scrapingBeeOptions.wait));
      sbUrl.searchParams.set('block_resources', String(config.scrapingBeeOptions.blockResources));
      sbUrl.searchParams.set('block_ads', String(config.scrapingBeeOptions.blockAds));
      sbUrl.searchParams.set('country_code', config.scrapingBeeOptions.countryCode);
      sbUrl.searchParams.set('wait_browser', 'load');
      
      // FIX 3: Add stealth_proxy for Saudi marketplaces
      if (config.useStealthProxy) {
        sbUrl.searchParams.set('stealth_proxy', 'true');
        console.log(`   🥷 Using stealth_proxy for ${config.name}`);
      }
      
      // FIX 3: Add price-based wait_for selectors
      if (config.waitForSelector) {
        sbUrl.searchParams.set('wait_for', config.waitForSelector);
        console.log(`   ⏳ Waiting for: ${config.waitForSelector}`);
      }
      
      const response = await fetch(sbUrl.toString());
      
      // Skip 503/500 gracefully
      if (response.status === 503 || response.status === 500) {
        console.log(`⏭️ ${config.name} unavailable (HTTP ${response.status}), skipping...`);
        break;
      }
      
      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`❌ HTTP ${response.status}: ${errorText.slice(0, 200)}`);
        continue;
      }
      
      const html = await response.text();
      console.log(`✅ Received ${html.length} chars`);
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      if (!doc) {
        break;
      }
      
      const containers = trySelectAll(doc, config.selectors.containers);
      if (containers.length === 0) {
        const fullBodySnippet = doc.body?.innerHTML?.substring(0, 2000).replace(/\s+/g, ' ') || '';
        const bodyText = doc.body?.textContent?.toLowerCase() || '';
        console.error(`❌ No containers found for ${config.name}`);
        console.log(`   HTML length: ${doc.body?.innerHTML?.length || 0} chars`);
        console.log(`   Has "product" keyword: ${bodyText.includes('product')}`);
        console.log(`   Has "price" keyword: ${bodyText.includes('price')}`);
        
        // AMAZON DEBUG: Add specific logging for Amazon
        if (config.name.includes('Amazon')) {
          console.log(`   🔍 AMAZON DEBUG:`);
          console.log(`      Has s-result-item: ${fullBodySnippet.includes('s-result-item')}`);
          console.log(`      Has data-asin: ${fullBodySnippet.includes('data-asin')}`);
          console.log(`      Has a-price: ${fullBodySnippet.includes('a-price')}`);
          console.log(`      Has captcha/robot: ${bodyText.includes('captcha') || bodyText.includes('robot')}`);
          console.log(`      Page title: ${doc.querySelector('title')?.textContent || 'N/A'}`);
        }
        
        console.log(`   HTML sample: ${fullBodySnippet.substring(0, 1000)}`);
        break;
      }
      
      const products: ScrapedProduct[] = [];
      const normalizedBaseline = normalizeProductName(fullProductName);
      
      // Container validation
      const validContainers = containers.filter((container: any) => {
        const hasLink = container.querySelector('a[href]');
        const containerText = container.textContent || '';
        const hasEnoughText = containerText.length > 20;
        const hasPricePattern = /\d{3,}/.test(containerText);
        return hasLink && hasEnoughText && hasPricePattern;
      });
      
      const containersToProcess = validContainers.length >= 3 ? validContainers : containers;
      console.log(`   📦 Processing ${containersToProcess.length} containers (validated: ${validContainers.length}/${containers.length})`);
      
      for (let i = 0; i < Math.min(containersToProcess.length, 50); i++) {
        const container = containersToProcess[i];
        
        let nameEl = trySelectOne(container, config.selectors.productName);
        let name = nameEl?.textContent?.trim();
        
        // FALLBACK: If CSS selectors fail
        if (!name) {
          nameEl = container.querySelector('h1, h2, h3, h4, a[title], a[href*="product"]');
          name = nameEl?.textContent?.trim();
        }
        
        if (!name || name.length < 5) {
          continue;
        }
        
        // Try CSS selectors for price first
        let priceEl = trySelectOne(container, config.selectors.price);
        let priceText = priceEl?.textContent?.trim();
        
        // FALLBACK for price
        if (!priceText) {
          const containerHtml = container.innerHTML || '';
          const currencyPattern = currency === 'SAR' 
            ? /(?:SAR|SR|ریال)\s*([0-9,]+(?:\.[0-9]+)?)|([0-9,]+(?:\.[0-9]+)?)\s*(?:SAR|SR|ریال)/gi
            : /\$\s*([0-9,]+(?:\.[0-9]+)?)|([0-9,]+(?:\.[0-9]+)?)\s*USD/gi;
          
          const priceMatch = containerHtml.match(currencyPattern);
          if (priceMatch && priceMatch.length > 0) {
            priceText = priceMatch[0];
          }
        }
        
        if (!priceText) {
          if (i < 5) {
            console.log(`   [${i}] ⚠️ No price found for "${name.slice(0, 30)}...". HTML sample: ${container.innerHTML?.substring(0, 300)}`);
          }
          continue;
        }
        
        const extracted = extractPrice(priceText, currency, fullProductName);
        if (!extracted || extracted.price <= 0) {
          continue;
        }
        
        // FIX 4: Apply Floor Rule validation
        if (!isValidPrice(extracted.price, baselinePrice, costPrice)) {
          continue;
        }
        
        const normalizedCompetitor = normalizeProductName(name);
        const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
        const priceRatio = extracted.price / baselinePrice;
        
        let adjustedSimilarity = similarity;
        if (priceRatio < 0.2 || priceRatio > 3.0) {
          adjustedSimilarity = similarity * 0.6;
        } else if (priceRatio < 0.4 || priceRatio > 2.5) {
          adjustedSimilarity = similarity * 0.8;
        }
        
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
      
      if (products.length > 0) {
        allProducts = allProducts.concat(products);
        console.log(`✓ Query variation ${queryIndex + 1} found ${products.length} products`);
        break;
      } else {
        if (containersToProcess.length > 0) {
          console.log(`   ❌ Found ${containersToProcess.length} containers but extracted 0 products`);
          console.log(`   📝 First container HTML sample:`);
          console.log(containersToProcess[0]?.innerHTML?.substring(0, 500));
        }
        break;
      }
      
    } catch (error: any) {
      console.error(`❌ Error scraping ${config.name}:`, error.message);
      continue;
    }
    
    if (allProducts.length > 0) {
      break;
    }
  }
  
  return allProducts
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 30);
}

// ========================================
// FIX 3: GOOGLE-FIRST DISCOVERY FOR EXTRA/JARIR
// ========================================

/**
 * Use Google to find direct product URLs for sites that block search pages
 * "Google Dorking" - searches site:extra.com Samsung S24 Ultra
 */
async function findProductLinkViaGoogle(
  siteDomain: string,
  productName: string
): Promise<string | null> {
  const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  if (!scrapingbeeApiKey) return null;
  
  // FIX: Add exclusions to Google Dork query for better results
  const lowerName = productName.toLowerCase();
  const exclusions: string[] = [];
  
  // Add noise word exclusions if not in product name
  for (const word of NOISE_WORDS.slice(0, 10)) { // Limit to top 10 exclusions
    if (!lowerName.includes(word)) {
      exclusions.push(`-${word}`);
    }
  }
  
  const query = `site:${siteDomain} ${productName} ${exclusions.join(' ')}`;
  console.log(`🔎 Google Dorking: "${query.slice(0, 80)}..."`);
  
  const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  
  const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
  sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
  sbUrl.searchParams.set('url', googleUrl);
  sbUrl.searchParams.set('custom_google', 'true');
  sbUrl.searchParams.set('render_js', 'false'); // Faster - just need links
  
  try {
    const response = await fetch(sbUrl.toString());
    if (!response.ok) {
      console.log(`   ❌ Google Dork failed: HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc) return null;
    
    // Find first valid result link pointing to target domain
    const allLinks = doc.querySelectorAll('a[href]') as any;
    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      const href = link?.getAttribute?.('href') || '';
      if (href && href.includes(siteDomain) && href.startsWith('http')) {
        // Skip non-product pages
        if (href.includes('/search') || href.includes('?q=') || href.includes('/category/')) {
          continue;
        }
        console.log(`   ✅ Found URL: ${href.slice(0, 70)}...`);
        return href;
      }
    }
    
    console.log(`   ⚠️ No direct product link found for ${siteDomain}`);
    return null;
  } catch (err: any) {
    console.log(`   ❌ Google Dork error: ${err.message}`);
    return null;
  }
}

/**
 * Scrape a direct product detail page (simpler than search results)
 */
async function scrapeDirectProductPage(
  url: string,
  siteName: string,
  baselinePrice: number,
  currency: string,
  baselineFullName: string,
  costPrice?: number
): Promise<ScrapedProduct | null> {
  const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
  if (!scrapingbeeApiKey) return null;
  
  console.log(`📦 Scraping direct page: ${url.slice(0, 60)}...`);
  
  const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
  sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
  sbUrl.searchParams.set('url', url);
  sbUrl.searchParams.set('render_js', 'true');
  sbUrl.searchParams.set('stealth_proxy', 'true');
  sbUrl.searchParams.set('wait', '5000');
  
  // Site-specific wait_for selectors for product detail pages
  if (siteName === 'Extra') {
    sbUrl.searchParams.set('wait_for', '.product-price,.price-box,[data-qa="product-price"],.c_product-price');
  } else if (siteName === 'Jarir') {
    sbUrl.searchParams.set('wait_for', '.price-box,.price,[data-price-amount],.product-info-price');
  }
  
  try {
    const response = await fetch(sbUrl.toString());
    if (!response.ok) {
      console.log(`   ❌ Direct scrape HTTP ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    console.log(`   ✅ Received ${html.length} chars from product page`);
    
    // ========================================
    // PRIORITY 1: Try JSON-LD/OpenGraph extraction first (most reliable)
    // ========================================
    const universalData = extractUniversalData(html);
    
    if (universalData && universalData.name && universalData.price && universalData.price > 0) {
      // Validate price
      if (!isValidPrice(universalData.price, baselinePrice, costPrice)) {
        console.log(`   ⚠️ JSON-LD price ${universalData.price} failed validation, trying CSS fallback`);
      } else {
        const normalizedBaseline = normalizeProductName(baselineFullName);
        const normalizedCompetitor = normalizeProductName(universalData.name);
        const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
        
        console.log(`   📊 JSON-LD Product: "${universalData.name.slice(0, 50)}..." | Price: ${universalData.price} | Similarity: ${(similarity * 100).toFixed(0)}%`);
        
        return {
          name: universalData.name,
          price: universalData.price,
          similarity: similarity,
          priceRatio: universalData.price / baselinePrice,
          url: url,
          sourceStore: siteName
        };
      }
    }
    
    // ========================================
    // PRIORITY 2: Fall back to CSS selector extraction
    // ========================================
    console.log(`   ⚠️ JSON-LD failed, falling back to CSS selectors...`);
    
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    if (!doc) return null;
    
    // Product detail pages have simpler structure - title usually in h1
    const titleSelectors = ['h1', '.product-name', '[data-qa="product-name"]', '.product-title', 'h1.page-title'];
    let title = '';
    for (const selector of titleSelectors) {
      const el = doc.querySelector(selector);
      if (el?.textContent?.trim()) {
        title = el.textContent.trim();
        break;
      }
    }
    
    if (!title || title.length < 5) {
      console.log(`   ⚠️ Could not find product title`);
      return null;
    }
    
    // Price selectors for product detail pages
    // FIX 2: Enhanced selectors for Extra.com which uses SVG for currency
    const priceSelectors = [
      // Extra.com specific selectors
      '.c_product-price',
      '.product-price__value',
      '[data-qa="product-price"]',
      // Jarir/Magento specific selectors
      '.price-box .price',
      '[data-price-amount]',
      '.price-final_price .price',
      'span[data-price-type="finalPrice"]',
      '.product-info-price .price',
      // Noon specific selectors
      '[class*="priceNow"]',
      'span[class*="Price_now"]',
      'strong[class*="amount"]',
      // Generic selectors
      '.product-price',
      '.price',
      '.final-price',
      '.special-price .price',
      '.priceNow',
      // Last resort - any element with price in class
      '[class*="price"]'
    ];
    
    let price = 0;
    let priceMethod = '';
    
    // Try CSS selectors first
    for (const selector of priceSelectors) {
      const priceEl = doc.querySelector(selector);
      if (priceEl?.textContent) {
        const extracted = extractPrice(priceEl.textContent, currency, baselineFullName);
        if (extracted && extracted.price > 0) {
          price = extracted.price;
          priceMethod = `CSS: ${selector}`;
          console.log(`   💰 Found price: ${price} ${currency} (via ${selector})`);
          break;
        }
      }
    }
    
    // FIX 2: Fallback to text-based extraction for Extra.com SVG currency issue
    if (price <= 0) {
      const bodyText = doc.body?.textContent || '';
      const fallbackPrice = extractPriceFromContainerText(bodyText, currency);
      if (fallbackPrice && fallbackPrice.price > 0) {
        price = fallbackPrice.price;
        priceMethod = `Text fallback: ${fallbackPrice.method}`;
        console.log(`   💰 Found price via text fallback: ${price} ${currency} (${fallbackPrice.method})`);
      }
    }
    
    if (price <= 0) {
      console.log(`   ⚠️ Could not extract price from page`);
      return null;
    }
    
    // Validate price
    if (!isValidPrice(price, baselinePrice, costPrice)) {
      console.log(`   ⚠️ Price ${price} failed validation`);
      return null;
    }
    
    const normalizedBaseline = normalizeProductName(baselineFullName);
    const normalizedCompetitor = normalizeProductName(title);
    const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
    
    console.log(`   📊 Product: "${title.slice(0, 50)}..." | Price: ${price} | Similarity: ${(similarity * 100).toFixed(0)}%`);
    
    return {
      name: title,
      price: price,
      similarity: similarity,
      priceRatio: price / baselinePrice,
      url: url,
      sourceStore: siteName
    };
  } catch (err: any) {
    console.log(`   ❌ Direct scrape error: ${err.message}`);
    return null;
  }
}

// ========================================
// SINGLE MARKETPLACE SCRAPER WITH TIMEOUT
// ========================================

async function scrapeMarketplaceWithTimeout(
  marketplaceKey: string,
  config: MarketplaceConfig,
  coreProductName: string,
  baseline: any,
  baselineIsAccessory: boolean,
  supabase: any
): Promise<ScrapeResult> {
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📡 [${marketplaceKey}] Starting scrape at ${new Date().toISOString()}`);
  console.log(`   Config: wait=${config.scrapingBeeOptions.wait}ms, country=${config.scrapingBeeOptions.countryCode}`);
  console.log(`   URL pattern: ${config.searchUrl}`);
  console.log(`${'='.repeat(60)}`);
  
  try {
    let products: ScrapedProduct[] = [];
    
    // Scrape with timeout
    try {
      const scrapeStartTime = Date.now();
      
      if (marketplaceKey === 'google-shopping') {
        console.log(`   🛒 Using Google Shopping scraper...`);
        products = await Promise.race([
          scrapeGoogleShopping(
            coreProductName,
            baseline.current_price,
            baseline.currency,
            baseline.product_name
          ),
          new Promise<ScrapedProduct[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), MARKETPLACE_TIMEOUT)
          )
        ]);
      } else {
        console.log(`   🏪 Using marketplace scraper for ${config.name}...`);
        products = await Promise.race([
          scrapeMarketplacePrices(
            config,
            coreProductName,
            baseline.product_name,
            baseline.current_price,
            baseline.currency,
            baseline.cost_per_unit
          ),
          new Promise<ScrapedProduct[]>((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), MARKETPLACE_TIMEOUT)
          )
        ]);
      }
      
      const scrapeEndTime = Date.now();
      console.log(`   ⏱️ Scrape completed in ${scrapeEndTime - scrapeStartTime}ms`);
      console.log(`   📦 Raw products returned: ${products.length}`);
      
    } catch (timeoutError: any) {
      if (timeoutError.message === 'Timeout') {
        const elapsed = Date.now() - startTime;
        console.log(`   ❌ TIMEOUT after ${elapsed}ms (limit: ${MARKETPLACE_TIMEOUT}ms)`);
        console.log(`   📊 Diagnosis: ScrapingBee or website too slow`);
        
        return {
          marketplace: config.name,
          products: [],
          status: 'timeout',
          elapsed
        };
      }
      throw timeoutError;
    }
    
    // Log what we got
    if (products.length === 0) {
      console.log(`   ⚠️ NO PRODUCTS RETURNED`);
      console.log(`   📊 Diagnosis: Either wrong selectors OR website blocked/empty`);
    } else {
      console.log(`   ✅ Got ${products.length} products before filtering`);
      products.slice(0, 3).forEach((p, i) => {
        console.log(`      [${i}] "${p.name.slice(0, 50)}..." - ${p.price} ${baseline.currency} (sim: ${(p.similarity * 100).toFixed(0)}%)`);
      });
    }
    
    // Apply accessory filtering
    if (products.length > 0) {
      const beforeFilter = products.length;
      
      if (baselineIsAccessory) {
        products = products.filter(product => {
          const isAccessory = isAccessoryOrReplacement(product.name);
          if (!isAccessory) {
            console.log(`   ⏭️ Filtered main product: "${product.name.slice(0, 40)}..."`);
          }
          return isAccessory;
        });
        console.log(`   🔍 Accessory filter: ${beforeFilter} → ${products.length} (kept accessories)`);
      } else {
        products = products.filter(product => {
          const isAccessory = isAccessoryOrReplacement(product.name);
          if (isAccessory) {
            console.log(`   ⏭️ Filtered accessory: "${product.name.slice(0, 40)}..."`);
          }
          return !isAccessory;
        });
        console.log(`   🔍 Accessory filter: ${beforeFilter} → ${products.length} (removed accessories)`);
      }
    }
    
    // Model mismatch filtering for electronics
    if (baseline.category === 'Electronics & Technology' && products.length > 0) {
      const beforeModelFilter = products.length;
      products = products.filter(product => {
        const isMismatch = isModelMismatch(baseline.product_name, product.name);
        if (isMismatch) {
          console.log(`   ⏭️ Model mismatch: "${product.name.slice(0, 40)}..."`);
        }
        return !isMismatch;
      });
      console.log(`   🔍 Model filter: ${beforeModelFilter} → ${products.length}`);
    }
    
    // AI validation for medium confidence products
    if (products.length > 0) {
      const mediumConfidenceProducts = products.filter(p => p.similarity >= 0.30 && p.similarity < 0.80);
      
      if (mediumConfidenceProducts.length > 0) {
        console.log(`   🤖 AI validating ${mediumConfidenceProducts.length} medium-confidence products...`);
        
        for (let i = 0; i < mediumConfidenceProducts.length; i += 5) {
          const batch = mediumConfidenceProducts.slice(i, i + 5);
          
          await Promise.all(batch.map(async (product) => {
            try {
              const { data: validationResult, error: validationError } = await supabase.functions.invoke('validate-competitor', {
                body: {
                  your_product_name: baseline.product_name,
                  competitor_product_name: product.name,
                  marketplace: marketplaceKey,
                  baseline_price: baseline.current_price,
                  competitor_price: product.price,
                  similarity_score: product.similarity
                }
              });
              
              if (validationError) {
                console.log(`      ⚠️ AI error for "${product.name.slice(0, 30)}..."`);
                return;
              }
              
              const decision = validationResult?.decision?.toLowerCase().replace(/_/g, '');
              if (decision === 'accessory' || decision === 'differentproduct' || decision === 'different') {
                console.log(`      🤖 AI rejected: "${product.name.slice(0, 30)}..." → ${validationResult.decision}`);
                product.similarity = -1;
              }
            } catch (e) {
              console.log(`      ⚠️ AI exception: ${e}`);
            }
          }));
        }
        
        const beforeAiFilter = products.length;
        products = products.filter(p => p.similarity >= 0);
        if (beforeAiFilter > products.length) {
          console.log(`   🤖 AI filter: ${beforeAiFilter} → ${products.length}`);
        }
      }
    }
    
    // Similarity threshold
    if (products.length > 0) {
      const beforeSimilarityFilter = products.length;
      products = products.filter(p => p.similarity >= 0.60);
      if (beforeSimilarityFilter > products.length) {
        console.log(`   🎯 Similarity filter: ${beforeSimilarityFilter} → ${products.length} (removed <60%)`);
      }
    }
    
    const elapsed = Date.now() - startTime;
    
    if (products.length > 0) {
      console.log(`   📊 RESULT: SUCCESS - ${products.length} products in ${elapsed}ms`);
      return {
        marketplace: config.name,
        products,
        status: 'success',
        elapsed
      };
    } else {
      console.log(`   📊 RESULT: NO DATA - 0 products after filtering in ${elapsed}ms`);
      console.log(`   📊 Diagnosis: Products found but all filtered out OR wrong selectors`);
      return {
        marketplace: config.name,
        products: [],
        status: 'no_data',
        elapsed
      };
    }
    
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`   ❌ ERROR after ${elapsed}ms:`, error.message);
    
    return {
      marketplace: config.name,
      products: [],
      status: 'error',
      elapsed,
      error: error?.message || 'Unknown error'
    };
  }
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

    console.log('🚀 Refreshing competitor prices');
    console.log(`   Product: "${baseline.product_name}"`);
    console.log(`   Baseline Price: ${baseline.current_price} ${baseline.currency}`);
    console.log(`   Cost: ${baseline.cost_per_unit || 'N/A'} ${baseline.currency}`);
    
    // Check if baseline product is an accessory
    const baselineIsAccessory = isAccessoryOrReplacement(baseline.product_name);
    console.log(`   Type: ${baselineIsAccessory ? 'Accessory' : 'Main Product'}`);
    console.log(`   Filter mode: ${baselineIsAccessory ? 'Keep accessories' : 'Filter accessories'}`);
    
    // Extract core product name for better search results
    const coreProductName = extractCoreProductName(baseline.product_name);
    console.log(`   Core name: "${coreProductName}"`);

    // ========================================
    // STEP 1: CHECK CACHE FOR SIMILAR PRODUCTS
    // ========================================
    console.log(`\n📦 Checking cache for similar products...`);
    console.log(`   Cache settings: ${CACHE_MAX_AGE_DAYS} days, ${(CACHE_MIN_SIMILARITY * 100).toFixed(0)}% similarity, threshold ${CACHE_THRESHOLD} items`);
    
    let cachedProducts: any[] = [];
    let cacheSourceBaselineId: string | null = null;
    
    try {
      // Find recent baselines with similar product names (last 15 days)
      const cacheAgeDate = new Date();
      cacheAgeDate.setDate(cacheAgeDate.getDate() - CACHE_MAX_AGE_DAYS);
      
      const { data: recentBaselines, error: baselinesError } = await supabase
        .from('product_baselines')
        .select('id, product_name, created_at')
        .eq('merchant_id', user.id)
        .neq('id', baseline_id) // Exclude current baseline
        .is('deleted_at', null)
        .gte('created_at', cacheAgeDate.toISOString())
        .order('created_at', { ascending: false });
      
      if (!baselinesError && recentBaselines && recentBaselines.length > 0) {
        // Find the most similar baseline
        const normalizedCurrentName = normalizeProductName(baseline.product_name);
        
        for (const recentBaseline of recentBaselines) {
          const normalizedRecentName = normalizeProductName(recentBaseline.product_name);
          const similarity = calculateSimilarity(normalizedCurrentName, normalizedRecentName);
          
          if (similarity >= CACHE_MIN_SIMILARITY) {
            console.log(`   ✅ Found similar baseline: "${recentBaseline.product_name.slice(0, 50)}..." (${(similarity * 100).toFixed(0)}% match)`);
            
            // Fetch cached competitor products from this baseline
            const { data: cached, error: cachedError } = await supabase
              .from('competitor_products')
              .select('*')
              .eq('baseline_id', recentBaseline.id);
            
            if (!cachedError && cached && cached.length > 0) {
              cachedProducts = cached;
              cacheSourceBaselineId = recentBaseline.id;
              console.log(`   📦 Loaded ${cachedProducts.length} cached products from baseline ${recentBaseline.id.slice(0, 8)}...`);
              break; // Use first matching baseline
            }
          }
        }
      }
      
      if (cachedProducts.length === 0) {
        console.log(`   ℹ️ No suitable cache found`);
      }
    } catch (cacheError) {
      console.log(`   ⚠️ Cache check error: ${cacheError}`);
      // Continue without cache
    }

    // Delete existing data for this baseline (we'll clone cache + add fresh)
    await supabase
      .from('competitor_prices')
      .delete()
      .eq('baseline_id', baseline_id);
    
    await supabase
      .from('competitor_products')
      .delete()
      .eq('baseline_id', baseline_id);

    // ========================================
    // STEP 2: CLONE CACHED PRODUCTS TO NEW BASELINE
    // ========================================
    let finalProducts: any[] = [];
    
    if (cachedProducts.length > 0) {
      console.log(`\n📋 Cloning ${cachedProducts.length} cached products to new baseline...`);
      
      const clonedRows = cachedProducts.map((product, index) => ({
        baseline_id,
        merchant_id: baseline.merchant_id,
        marketplace: product.marketplace,
        product_name: product.product_name,
        price: product.price,
        similarity_score: product.similarity_score,
        price_ratio: product.price_ratio,
        product_url: product.product_url,
        currency: baseline.currency,
        rank: index + 1,
        is_cached: true,
        cached_from_baseline_id: cacheSourceBaselineId
      }));
      
      const { error: cloneError } = await supabase
        .from('competitor_products')
        .insert(clonedRows);
      
      if (cloneError) {
        console.error(`   ❌ Clone error: ${cloneError.message}`);
      } else {
        finalProducts = [...clonedRows];
        console.log(`   ✅ Cloned ${clonedRows.length} products successfully`);
      }
    }

    // ========================================
    // STEP 3: DECIDE SCRAPING STRATEGY
    // ========================================
    const shouldFullScrape = cachedProducts.length < CACHE_THRESHOLD;
    const shouldGoogleOnlyScrape = cachedProducts.length >= CACHE_THRESHOLD;
    
    console.log(`\n🎯 Scraping Decision:`);
    console.log(`   Cached products: ${cachedProducts.length}`);
    console.log(`   Threshold: ${CACHE_THRESHOLD}`);
    
    if (shouldFullScrape) {
      console.log(`   Strategy: FULL SCRAPING (need more data)`);
    } else {
      console.log(`   Strategy: GOOGLE-ONLY GAP-FILL (have enough cached data)`);
    }

    // Select marketplaces based on currency and strategy
    let marketplaceKeys: string[];
    if (shouldGoogleOnlyScrape) {
      // Google-only for gap-fill when we have enough cached products
      marketplaceKeys = ['google-shopping'];
      console.log(`   Marketplaces: google-shopping only`);
    } else {
      // Full scraping when cache is insufficient
      marketplaceKeys = baseline.currency === 'SAR' 
        ? ['google-shopping', 'amazon', 'noon', 'extra', 'jarir']
        : ['google-shopping', 'amazon-us', 'walmart', 'ebay', 'target'];
      console.log(`   Marketplaces: ${marketplaceKeys.join(', ')}`);
    }
    
    // Simplified product name for Google-First discovery
    const simplifiedProductName = simplifyTitle(baseline.product_name);
    
    // ========================================
    // STEP 4: FAULT-TOLERANT PARALLEL SCRAPING
    // ========================================
    console.log(`\n🚀 Starting ${shouldGoogleOnlyScrape ? 'GOOGLE-ONLY' : 'PARALLEL'} scraping (${marketplaceKeys.length} marketplace${marketplaceKeys.length > 1 ? 's' : ''})...`);
    console.log(`   Timeout per marketplace: ${MARKETPLACE_TIMEOUT / 1000}s`);
    // Log which marketplaces use Google-First discovery
    const googleFirstMarkets = marketplaceKeys.filter(k => MARKETPLACE_CONFIGS[k]?.useGoogleFirstDiscovery);
    if (googleFirstMarkets.length > 0) {
      console.log(`   Using Google-First Discovery for: ${googleFirstMarkets.join(', ')}`);
    }
    
    let scrapeResults: ScrapeResult[] = [];
    
    try {
      // Fire all scrapers in parallel - wrapped in fault-tolerant try/catch
      scrapeResults = await Promise.all(
        marketplaceKeys.map(async (marketplaceKey) => {
          const config = MARKETPLACE_CONFIGS[marketplaceKey];
          const startTime = Date.now();
        
        // Each scraper wrapped in try/catch - one failure won't stop others
        try {
          // FIX 1: Use Google-First Discovery for marketplaces that have it enabled
          if (config.useGoogleFirstDiscovery) {
            const siteDomain = marketplaceKey === 'extra' ? 'extra.com' : 
                              marketplaceKey === 'jarir' ? 'jarir.com' : 
                              new URL(config.searchUrl).hostname;
            
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📡 [${marketplaceKey}] Using Google-First Discovery for ${siteDomain}`);
            console.log(`${'='.repeat(60)}`);
            
            // Step 1: Find product URL via Google
            const productUrl = await findProductLinkViaGoogle(siteDomain, simplifiedProductName);
            
            if (!productUrl) {
              const elapsed = Date.now() - startTime;
              console.log(`   📊 RESULT: NO_URL - Could not find product on ${siteDomain}`);
              return {
                marketplace: config.name,
                products: [],
                status: 'no_data' as const,
                elapsed
              };
            }
            
            // Step 2: Scrape that specific product page
            const product = await scrapeDirectProductPage(
              productUrl,
              config.name,
              baseline.current_price,
              baseline.currency,
              baseline.product_name,
              baseline.cost_per_unit
            );
            
            const elapsed = Date.now() - startTime;
            
            if (product && product.similarity >= 0.60) {
              // Apply model mismatch filter for electronics
              if (baseline.category === 'Electronics & Technology') {
                if (isModelMismatch(baseline.product_name, product.name)) {
                  console.log(`   ⏭️ Model mismatch, rejecting`);
                  return {
                    marketplace: config.name,
                    products: [],
                    status: 'no_data' as const,
                    elapsed
                  };
                }
              }
              
              console.log(`   📊 RESULT: SUCCESS - 1 product via Google-First in ${elapsed}ms`);
              return {
                marketplace: config.name,
                products: [product],
                status: 'success' as const,
                elapsed
              };
            } else {
              console.log(`   📊 RESULT: NO_DATA - Product found but ${product ? `low similarity (${(product.similarity * 100).toFixed(0)}%)` : 'extraction failed'}`);
              return {
                marketplace: config.name,
                products: [],
                status: 'no_data' as const,
                elapsed
              };
            }
          }
          
          // Standard scraping for Amazon, Noon, Google Shopping
          return await scrapeMarketplaceWithTimeout(
            marketplaceKey,
            config,
            coreProductName,
            baseline,
            baselineIsAccessory,
            supabase
          );
        } catch (err: any) {
          // Catch ANY unexpected error - never let it escape
          console.log(`❌ ${config.name} crashed: ${err.message}`);
          return {
            marketplace: config.name,
            products: [],
            status: 'error' as const,
            elapsed: Date.now() - startTime,
            error: err.message
          };
        }
      })
    );
    } catch (scrapingError: any) {
      // Fault-tolerant: If entire scraping fails, continue with cached data
      console.log(`⚠️ Scraping block failed: ${scrapingError.message}`);
      console.log(`   Continuing with ${cachedProducts.length} cached products...`);
      scrapeResults = [];
    }

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SCRAPING SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    
    const results: any[] = [];
    const failedMarketplaces: string[] = [];
    let foundValidProducts = cachedProducts.length > 0; // Already have cached products
    
    for (let i = 0; i < scrapeResults.length; i++) {
      const result = scrapeResults[i];
      const marketplaceKey = marketplaceKeys[i];
      
      const statusIcon = result.status === 'success' ? '✅' : result.status === 'timeout' ? '⏱️' : '❌';
      console.log(`${statusIcon} ${result.marketplace}: ${result.status} (${result.elapsed}ms)${result.products.length ? ` - ${result.products.length} products` : ''}`);
      
      // Save results to database
      if (result.products.length > 0) {
        foundValidProducts = true;
        
        // Apply price outlier detection (5x from average)
        let filteredProducts = result.products;
        if (result.products.length >= 2) {
          filteredProducts = filterLowestPriceOutliers(result.products);
        }
        
        if (filteredProducts.length === 0) {
          console.log(`   ⚠️ All products filtered as outliers for ${result.marketplace}`);
          failedMarketplaces.push(marketplaceKey);
          continue;
        }
        
        const productRows = filteredProducts.map((product: ScrapedProduct, index: number) => ({
          baseline_id,
          merchant_id: baseline.merchant_id,
          marketplace: marketplaceKey === 'google-shopping' && product.sourceStore && product.sourceStore !== 'Unknown'
            ? product.sourceStore
            : marketplaceKey === 'google-shopping' ? 'Google' : marketplaceKey,
          product_name: product.name,
          price: product.price,
          similarity_score: product.similarity,
          price_ratio: product.priceRatio,
          product_url: product.url,
          currency: baseline.currency,
          rank: index + 1,
          is_cached: false, // Fresh scrape
          cached_from_baseline_id: null
        }));
        
        const { error: productsError } = await supabase
          .from('competitor_products')
          .insert(productRows);
        
        if (productsError) {
          console.error(`   ❌ DB insert error for ${result.marketplace}:`, productsError);
        }
        
        const highSimilarityProducts = result.products.filter((p: ScrapedProduct) => p.similarity >= 0.60);
        const prices = highSimilarityProducts.map((p: ScrapedProduct) => p.price);
        const lowest = Math.min(...prices);
        const highest = Math.max(...prices);
        const average = prices.reduce((a: number, b: number) => a + b, 0) / prices.length;
        
        // FIX: Use upsert to prevent duplicate records
        await supabase.from('competitor_prices').upsert({
          baseline_id,
          merchant_id: baseline.merchant_id,
          marketplace: marketplaceKey,
          lowest_price: lowest,
          average_price: average,
          highest_price: highest,
          currency: baseline.currency,
          products_found: highSimilarityProducts.length,
          fetch_status: 'success',
          last_updated: new Date().toISOString()
        }, { onConflict: 'baseline_id,marketplace' });
        
        results.push({
          marketplace: result.marketplace,
          status: 'success',
          products_found: highSimilarityProducts.length,
          lowest,
          average,
          highest,
          elapsed: result.elapsed
        });
      } else {
        failedMarketplaces.push(marketplaceKey);
        
        // FIX: Use upsert to prevent duplicate records
        await supabase.from('competitor_prices').upsert({
          baseline_id,
          merchant_id: baseline.merchant_id,
          marketplace: marketplaceKey,
          currency: baseline.currency,
          fetch_status: result.status,
          last_updated: new Date().toISOString()
        }, { onConflict: 'baseline_id,marketplace' });
        
        results.push({
          marketplace: result.marketplace,
          status: result.status,
          elapsed: result.elapsed,
          error: result.error
        });
      }
    }
    
    console.log(`${'='.repeat(60)}`);

    // Count total valid products
    const { data: totalProducts } = await supabase
      .from('competitor_products')
      .select('id', { count: 'exact' })
      .eq('baseline_id', baseline_id);
    
    const totalProductCount = totalProducts?.length || 0;
    console.log(`\n📊 Total products found across all marketplaces: ${totalProductCount}`);
    
    // GOOGLE FALLBACK: Trigger if insufficient products
    const insufficientProducts = totalProductCount < 3;
    const shouldUseGoogleFallback = insufficientProducts || !foundValidProducts || failedMarketplaces.length >= 2;
    
    if (shouldUseGoogleFallback) {
      console.log('\n=== GOOGLE FALLBACK TRIGGERED ===');
      if (insufficientProducts) {
        console.log(`Reason: Insufficient products (only ${totalProductCount} found, need at least 3)`);
      } else if (!foundValidProducts) {
        console.log('Reason: No products found across all marketplaces');
      } else if (failedMarketplaces.length >= 2) {
        console.log(`Reason: ${failedMarketplaces.length} marketplace(s) failed: ${failedMarketplaces.join(', ')}`);
      }
      
      try {
        let googleProducts: ScrapedProduct[] = [];
        
        const shoppingProducts = await scrapeGoogleShopping(
          coreProductName,
          baseline.current_price,
          baseline.currency,
          baseline.product_name
        );
        
        if (shoppingProducts.length > 0) {
          console.log(`✓ Google Shopping found ${shoppingProducts.length} products`);
          googleProducts = shoppingProducts;
        } else {
          console.log(`⚠️ Google Shopping returned 0, trying regular SERP...`);
          googleProducts = await scrapeGoogleSERP(
            coreProductName,
            baseline.current_price,
            baseline.currency,
            baseline.product_name
          );
        }
        
        // Apply accessory filtering
        if (googleProducts.length > 0) {
          const beforeFilter = googleProducts.length;
          if (baselineIsAccessory) {
            googleProducts = googleProducts.filter(product => isAccessoryOrReplacement(product.name));
            console.log(`🔍 Google filtering: ${beforeFilter} → ${googleProducts.length} products (kept accessories)`);
          } else {
            googleProducts = googleProducts.filter(product => !isAccessoryOrReplacement(product.name));
            console.log(`🔍 Google filtering: ${beforeFilter} → ${googleProducts.length} products`);
          }
        }
        
        // Model mismatch filtering
        if (baseline.category === 'Electronics & Technology' && googleProducts.length > 0) {
          const beforeModelFilter = googleProducts.length;
          googleProducts = googleProducts.filter(product => !isModelMismatch(baseline.product_name, product.name));
          console.log(`🔍 Google model filtering: ${beforeModelFilter} → ${googleProducts.length} products`);
        }
        
        // Similarity threshold
        if (googleProducts.length > 0) {
          const beforeSimilarityFilter = googleProducts.length;
          googleProducts = googleProducts.filter(p => p.similarity >= 0.60);
          if (beforeSimilarityFilter > googleProducts.length) {
            console.log(`🎯 Google similarity filter: ${beforeSimilarityFilter} → ${googleProducts.length} products`);
          }
        }
        
        // Apply price outlier detection (5x from average)
        if (googleProducts.length >= 2) {
          googleProducts = filterLowestPriceOutliers(googleProducts);
        }
        
        if (googleProducts.length > 0) {
          // Save individual products with their actual store names
          const productRows = googleProducts.map((product, index) => ({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: product.sourceStore && product.sourceStore !== 'Unknown'
              ? product.sourceStore
              : 'Unknown Store',
            product_name: product.name,
            price: product.price,
            similarity_score: product.similarity,
            price_ratio: product.priceRatio,
            product_url: product.url,
            currency: baseline.currency,
            rank: index + 1,
            is_cached: false, // Fresh scrape from Google fallback
            cached_from_baseline_id: null
          }));
          
          await supabase.from('competitor_products').insert(productRows);
          
          // Group products by normalized marketplace for aggregation
          const highSimilarityProducts = googleProducts.filter(p => p.similarity >= 0.60);
          const productsByMarketplace: Record<string, typeof highSimilarityProducts> = {};
          
          for (const product of highSimilarityProducts) {
            const marketplace = normalizeStoreToMarketplace(product.sourceStore);
            if (!productsByMarketplace[marketplace]) {
              productsByMarketplace[marketplace] = [];
            }
            productsByMarketplace[marketplace].push(product);
          }
          
          // Upsert aggregated prices for EACH store separately
          const storesFound: string[] = [];
          for (const [marketplace, products] of Object.entries(productsByMarketplace)) {
            const prices = products.map(p => p.price);
            
            await supabase.from('competitor_prices').upsert({
              baseline_id,
              merchant_id: baseline.merchant_id,
              marketplace: marketplace, // "amazon", "noon", "Pricena", etc.
              lowest_price: Math.min(...prices),
              average_price: prices.reduce((a, b) => a + b, 0) / prices.length,
              highest_price: Math.max(...prices),
              currency: baseline.currency,
              products_found: products.length,
              fetch_status: 'success',
              last_updated: new Date().toISOString()
            }, { onConflict: 'baseline_id,marketplace' });
            
            console.log(`✓ Google found ${products.length} products from ${marketplace}`);
            storesFound.push(marketplace);
          }
          
          results.push({
            marketplace: 'Google Shopping (Fallback)',
            status: 'success',
            products_found: highSimilarityProducts.length,
            stores_found: storesFound
          });
          
          console.log(`✓ Google fallback found ${googleProducts.length} products across ${storesFound.length} stores`);
        } else {
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

    // Final summary with caching info
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 FINAL SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`   Cached products used: ${cachedProducts.length}`);
    console.log(`   Fresh products scraped: ${scrapeResults.reduce((sum, r) => sum + r.products.length, 0)}`);
    console.log(`   Scraping strategy: ${shouldGoogleOnlyScrape ? 'Google-only gap-fill' : 'Full scraping'}`);
    console.log(`${'='.repeat(60)}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        baseline_id, 
        results,
        cache_info: {
          cached_products_used: cachedProducts.length,
          cache_source_baseline_id: cacheSourceBaselineId,
          scraping_strategy: shouldGoogleOnlyScrape ? 'google-only' : 'full'
        }
      }),
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
