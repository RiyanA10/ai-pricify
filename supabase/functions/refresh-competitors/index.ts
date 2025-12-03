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
      wait: 7000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
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
        // More generic fallbacks
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
        // Generic fallbacks
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
        // Generic fallbacks
        '[class*="price"] span:first-child',
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
        // Generic fallbacks
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
        // Generic fallbacks
        'a[href*="/product/"]',
        'h2 a', 'h3 a',
        '[class*="title"] a',
        '[class*="name"]'
      ],
      price: [
        '[data-qa="product-price"]',
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
        // Generic fallbacks
        '[class*="price"]:not([class*="was"])',
        'strong'
      ]
    }
  },
  'jarir': {
    name: 'Jarir',
    searchUrl: 'https://www.jarir.com/sa-en/catalogsearch/result/?q=',
    scrapingBeeOptions: {
      renderJs: true,
      wait: 6000,
      blockResources: false,
      blockAds: true,
      countryCode: 'sa'
    },
    selectors: {
      containers: [
        // Primary - Magento-based selectors
        '.product-items .product-item',
        '.products.list .product-item',
        'li.product-item',
        'div.product-item-info',
        // Fallback - generic
        'div.products-grid .item',
        'ol.products.list .item',
        'div[data-product-sku]',
        'article.product',
        // Generic fallbacks
        'a[href*="/product/"]',
        'div:has(a[href]):has(.price)',
        'div[class*="product"]'
      ],
      productName: [
        // Magento standard
        '.product-item-info .product-item-link',
        'a.product-item-link',
        '.product-item-name a',
        '.product.name a',
        // Fallback
        'h2.product-name a',
        'span.product-item-link',
        'a[class*="product-name"]',
        '.product-title',
        // Generic fallbacks
        'a[href*="/product/"]',
        'h2 a', 'h3 a'
      ],
      price: [
        // Magento standard
        '.price-box .price',
        'span[data-price-amount]',
        '[data-price-type="finalPrice"] .price',
        '.price-wrapper .price',
        // Fallback
        '.price-final_price .price',
        'span.price',
        'span[class*="price-value"]',
        'div.price-box span.price',
        'span[data-price-type="finalPrice"]',
        'span.special-price span.price',
        '.final-price',
        '.sale-price',
        // Generic fallbacks
        '[class*="price"] span',
        'strong'
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
    
    // Screen protectors & films
    'screen protector', 'protector', 'tempered glass', 'glass film', 'film',
    'lens protector', 'camera protector', 'privacy screen',
    'screen guard', 'guard', 'shield',
    
    // Additional accessories
    'stand', 'mount', 'holder', 'strap', 'skin', 'sticker', 'decal',
    
    // Sets/pieces (not full product)
    'pcs', 'pieces', 'pair', 'set of', 'pack of', 
    '2 pack', '3 pack', '4 pack', '2-pack', '3-pack', '4-pack',
    '2pcs', '3pcs', '4pcs',
    
    // Arabic
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
 * Used to filter out wrong product versions (e.g., iPhone 13 vs iPhone 17)
 */
function extractModelInfo(productName: string): { 
  brand: string; 
  model: string; 
  version: number | null 
} {
  const lowerName = productName.toLowerCase();
  
  // ✅ FIX 1: iPhone Air detection FIRST (before regular iPhones)
  if (lowerName.includes('iphone air')) {
    return {
      brand: 'iphone-air',  // Different brand identifier!
      model: 'air',
      version: null
    };
  }
  
  // iPhone detection: "iPhone 17 Pro Max" → { brand: "iphone", model: "pro max", version: 17 }
  const iphoneMatch = lowerName.match(/iphone\s*(\d+)\s*(pro\s*max|pro|plus|mini)?/i);
  if (iphoneMatch) {
    return {
      brand: 'iphone',
      model: (iphoneMatch[2] || 'standard').toLowerCase().replace(/\s+/g, ' ').trim(),
      version: parseInt(iphoneMatch[1])
    };
  }
  
  // Samsung Galaxy detection: "Galaxy S24 Ultra" → { brand: "galaxy", model: "s ultra", version: 24 }
  const galaxyMatch = lowerName.match(/galaxy\s*([sza])(\d+)\s*(ultra|plus|fe)?/i);
  if (galaxyMatch) {
    return {
      brand: 'galaxy',
      model: `${galaxyMatch[1]}${galaxyMatch[3] || ''}`.toLowerCase().replace(/\s+/g, ' ').trim(),
      version: parseInt(galaxyMatch[2])
    };
  }
  
  // Add more brands as needed...
  
  return { brand: '', model: '', version: null };
}

/**
 * Check if two products have mismatched model numbers
 * Returns TRUE if they are different models (should be filtered out)
 */
function isModelMismatch(baselineProduct: string, competitorProduct: string): boolean {
  const baseline = extractModelInfo(baselineProduct);
  const competitor = extractModelInfo(competitorProduct);
  
  // ✅ FIX 2: Check brand first (iPhone Air vs iPhone)
  if (baseline.brand !== competitor.brand) {
    return true; // Different brands (e.g., iphone-air vs iphone)
  }
  
  // If both are iPhones, version must match
  if (baseline.brand === 'iphone' && competitor.brand === 'iphone') {
    if (baseline.version !== null && competitor.version !== null) {
      const versionMatch = baseline.version === competitor.version;
      if (!versionMatch) {
        return true; // MISMATCH: Different iPhone versions
      }
    }
    
    // ✅ FIX 3: Model variant must ALSO match (Pro Max vs Pro)
    if (baseline.model && competitor.model) {
      const baselineModel = baseline.model.replace(/\s+/g, '');
      const competitorModel = competitor.model.replace(/\s+/g, '');
      if (baselineModel !== competitorModel) {
        return true; // MISMATCH: Different model variants (promax vs pro)
      }
    }
  }
  
  // If both are Galaxy phones, version must match
  if (baseline.brand === 'galaxy' && competitor.brand === 'galaxy') {
    if (baseline.version !== null && competitor.version !== null) {
      const versionMatch = baseline.version === competitor.version;
      if (!versionMatch) {
        return true; // MISMATCH: Different Galaxy versions
      }
    }
    
    // Also check model variant for Galaxy
    if (baseline.model && competitor.model) {
      const baselineModel = baseline.model.replace(/\s+/g, '');
      const competitorModel = competitor.model.replace(/\s+/g, '');
      if (baselineModel !== competitorModel) {
        return true; // MISMATCH: Different model variants
      }
    }
  }
  
  return false; // No mismatch detected
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

// ✅ FIX: Google SERP with stealth_proxy for reliable scraping
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
    // ✅ Use regular API with stealth_proxy to scrape Google search directly
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(productName + ' price')}`;
    
    const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
    sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
    sbUrl.searchParams.set('url', googleSearchUrl);
    sbUrl.searchParams.set('custom_google', 'true');  // ← CRITICAL: Required by ScrapingBee for Google
    sbUrl.searchParams.set('stealth_proxy', 'true');  // ← Critical for bypassing bot detection
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
    
    // Use Google organic search result selectors
    const containers = trySelectAll(doc, [
      'div.tF2Cxc',      // Google search result container
      'div.g',           // Classic search result
      '[data-hveid]',    // Attribute-based selector
      '.yuRUbf'          // URL/title container
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
      
      // Extract title
      const nameEl = trySelectOne(container, [
        'h3',
        '.LC20lb',
        'div[role="heading"]'
      ]);
      if (!nameEl) continue;
      
      const name = nameEl.textContent?.trim();
      if (!name) continue;
      
      // Extract snippet/description which might contain price
      const snippetEl = trySelectOne(container, [
        '.VwiC3b',
        '.lEBKkf',
        'div[data-content-feature="1"]',
        'div.s'
      ]);
      
      const snippet = snippetEl?.textContent?.trim() || '';
      const combinedText = `${name} ${snippet}`;
      
      // Try to extract price from combined text
      const extracted = extractPrice(combinedText, currency);
      if (!extracted || extracted.price <= 0) continue;
      
      const normalizedCompetitor = normalizeProductName(name);
      const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
      const priceRatio = extracted.price / baselinePrice;
      
      // Extract URL
      let productUrl: string | undefined;
      try {
        const linkEl = container.querySelector('a[href]');
        if (linkEl) {
          const href = linkEl.getAttribute('href');
          if (href) productUrl = href;
        }
      } catch (e) {
        // Ignore
      }
      
      products.push({
        name,
        price: extracted.price,
        similarity,
        priceRatio,
        url: productUrl
      });
    }
    
    console.log(`✓ Extracted ${products.length} products from Google SERP`);
    return products.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
    
  } catch (error: any) {
    console.error(`❌ Google SERP error:`, error.message);
    return [];
  }
}

// ✅ NEW: Dedicated Google Shopping scraper with stealth_proxy
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
  
  console.log(`\n🛒 Google Shopping Search (stealth_proxy)`);
  console.log(`   Query: "${productName}"`);
  
  try {
    // ✅ Use Google Shopping tab directly with stealth_proxy
    const shoppingUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(productName)}`;
    
    const sbUrl = new URL('https://app.scrapingbee.com/api/v1/');
    sbUrl.searchParams.set('api_key', scrapingbeeApiKey);
    sbUrl.searchParams.set('url', shoppingUrl);
    sbUrl.searchParams.set('custom_google', 'true');  // ← CRITICAL: Required by ScrapingBee for Google
    sbUrl.searchParams.set('stealth_proxy', 'true');  // ← Critical!
    sbUrl.searchParams.set('render_js', 'true');
    sbUrl.searchParams.set('wait', '5000');  // Shopping needs more time
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
    
    // Google Shopping product selectors
    const containers = trySelectAll(doc, [
      'div[data-sh-pr]',         // Shopping product container
      '.sh-dgr__content',        // Grid result
      '[data-docid]',            // Document ID
      '.sh-dlr__list-result',    // List result
      'div.sh-dgr__grid-result'  // Grid result alternative
    ]);
    
    if (containers.length === 0) {
      const bodySnippet = doc.body?.innerHTML?.substring(0, 500).replace(/\s+/g, ' ') || '';
      console.log(`⚠️ No Shopping results found. HTML sample: ${bodySnippet}`);
      return [];
    }
    
    console.log(`✓ Found ${containers.length} Shopping results`);
    
    const products: ScrapedProduct[] = [];
    const normalizedBaseline = normalizeProductName(baselineFullName);
    
    for (let i = 0; i < Math.min(containers.length, 30); i++) {
      const container = containers[i];
      
      const nameEl = trySelectOne(container, [
        'h3',
        'h4',
        '.sh-np__product-title',
        'div[role="heading"]',
        '[data-sh-pr] h3',
        '[data-sh-pr] h4'
      ]);
      if (!nameEl) continue;
      
      const name = nameEl.textContent?.trim();
      if (!name) continue;
      
      const priceEl = trySelectOne(container, [
        '.a8Pemb',
        'span[aria-label*="$"]',
        'span[aria-label*="SAR"]',
        'span[aria-label*="price"]',
        '[data-sh-pr] span.a8Pemb',
        'b'
      ]);
      if (!priceEl) continue;
      
      const priceText = priceEl.textContent?.trim();
      if (!priceText) continue;
      
      const extracted = extractPrice(priceText, currency);
      if (!extracted || extracted.price <= 0) continue;
      
      const normalizedCompetitor = normalizeProductName(name);
      const similarity = calculateSimilarity(normalizedBaseline, normalizedCompetitor);
      const priceRatio = extracted.price / baselinePrice;
      
      let productUrl: string | undefined;
      try {
        const linkEl = container.querySelector('a[href]');
        if (linkEl) {
          const href = linkEl.getAttribute('href');
          if (href) productUrl = href.startsWith('http') ? href : `https://www.google.com${href}`;
        }
      } catch (e) {
        // Ignore
      }
      
      products.push({
        name,
        price: extracted.price,
        similarity,
        priceRatio,
        url: productUrl
      });
    }
    
    console.log(`✓ Extracted ${products.length} products from Google Shopping`);
    return products.sort((a, b) => b.similarity - a.similarity).slice(0, 20);
    
  } catch (error: any) {
    console.error(`❌ Google Shopping error:`, error.message);
    return [];
  }
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
  
  // ✅ NEW: Try multiple search query variations
  const searchQueries = [
    productName,                                           // Original: "iPhone 17 Pro Max 256GB"
    productName.replace(/\s+/g, '%20'),                   // URL encoded spaces
    productName.split(' ').slice(0, 4).join(' '),        // Shorter: "iPhone 17 Pro Max"
    `Apple ${productName}`,                               // With brand prefix
  ];
  
  console.log(`\n🐝 Scraping ${config.name}`);
  console.log(`   Config:`, config.scrapingBeeOptions);
  
  let allProducts: ScrapedProduct[] = [];
  
  // Try each search query until we get products
  for (let queryIndex = 0; queryIndex < searchQueries.length; queryIndex++) {
    const query = searchQueries[queryIndex];
    const searchUrl = config.searchUrl + encodeURIComponent(query);
    
    if (queryIndex > 0) {
      console.log(`   📝 Trying variation ${queryIndex + 1}: "${query}"`);
    } else {
      console.log(`   URL: ${searchUrl}`);
    }
    
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
        
        // ✅ Add wait_for selector for JS-heavy marketplaces
        if (config.name === 'Extra') {
          sbUrl.searchParams.set('wait_for', 'div.product-tile,div[data-qa="product-tile"]');
        }
        if (config.name === 'Noon') {
          sbUrl.searchParams.set('wait_for', 'div[data-qa="product-card"]');
        }
        
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
          break; // Try next query variation
        }
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ HTTP ${response.status}: ${errorText}`);
          break; // Try next query variation
        }
        
        const html = await response.text();
        console.log(`✅ Received ${html.length} chars`);
        
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        if (!doc) {
          break; // Try next query variation
        }
        
        const containers = trySelectAll(doc, config.selectors.containers);
        if (containers.length === 0) {
          // ✅ Enhanced debug logging
          const fullBodySnippet = doc.body?.innerHTML?.substring(0, 2000).replace(/\s+/g, ' ') || '';
          const bodyText = doc.body?.textContent?.toLowerCase() || '';
          console.error(`❌ No containers found for ${config.name}`);
          console.log(`   HTML length: ${doc.body?.innerHTML?.length || 0} chars`);
          console.log(`   Has "product" keyword: ${bodyText.includes('product')}`);
          console.log(`   Has "price" keyword: ${bodyText.includes('price')}`);
          console.log(`   HTML sample: ${fullBodySnippet}`);
          break; // Try next query variation
        }
        
        const products: ScrapedProduct[] = [];
        const normalizedBaseline = normalizeProductName(fullProductName);
        
        // Container validation - filter to containers that likely have product data
        const validContainers = containers.filter((container: any) => {
          const hasLink = container.querySelector('a[href]');
          const containerText = container.textContent || '';
          const hasEnoughText = containerText.length > 20;
          const hasPricePattern = /\d{3,}/.test(containerText);
          return hasLink && hasEnoughText && hasPricePattern;
        });
        
        const containersToProcess = validContainers.length >= 3 ? validContainers : containers;
        console.log(`   📦 Processing ${containersToProcess.length} containers (validated: ${validContainers.length}/${containers.length})`);
        
        let debuggedContainers = 0;
        
        for (let i = 0; i < Math.min(containersToProcess.length, 50); i++) {
          const container = containersToProcess[i];
          
          // Try CSS selectors first
          let nameEl = trySelectOne(container, config.selectors.productName);
          let name = nameEl?.textContent?.trim();
          
          // FALLBACK 1: If CSS selectors fail, try generic heading/link text
          if (!name) {
            nameEl = container.querySelector('h1, h2, h3, h4, a[title], a[href*="product"]');
            name = nameEl?.textContent?.trim();
          }
          
          // FALLBACK 2: Try getting text from the first link's title attribute
          if (!name) {
            const firstLink = container.querySelector('a[href]');
            name = firstLink?.getAttribute('title') || firstLink?.textContent?.trim();
          }
          
          if (!name) {
            if (debuggedContainers < 3) {
              console.log(`   [${i}] ⚠️ No name found. HTML sample: ${container.innerHTML?.substring(0, 300)}`);
              debuggedContainers++;
            }
            continue;
          }
          
          // Try CSS selectors for price first
          let priceEl = trySelectOne(container, config.selectors.price);
          let priceText = priceEl?.textContent?.trim();
          
          // FALLBACK: Search entire container text for price pattern (SAR/SR)
          if (!priceText) {
            const containerText = container.textContent || '';
            // Look for SAR price patterns
            const priceMatch = containerText.match(/(?:SAR|SR|ر\.س\.?)\s*([0-9,]+(?:\.[0-9]{2})?)/i) 
              || containerText.match(/([0-9,]+(?:\.[0-9]{2})?)\s*(?:SAR|SR|ر\.س)/i)
              || containerText.match(/\b([0-9]{3,}(?:,[0-9]{3})*(?:\.[0-9]{2})?)\b/);
            if (priceMatch) {
              priceText = priceMatch[0];
            }
          }
          
          if (!priceText) {
            if (debuggedContainers < 3) {
              console.log(`   [${i}] ⚠️ No price found for "${name.substring(0, 30)}...". HTML sample: ${container.innerHTML?.substring(0, 300)}`);
              debuggedContainers++;
            }
            continue;
          }
          
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
          // Found products, add to collection
          allProducts = allProducts.concat(products);
          console.log(`✓ Query variation ${queryIndex + 1} found ${products.length} products`);
          break; // Exit retry loop
        } else {
          // Enhanced debug: show first container's full HTML when no products extracted
          if (containersToProcess.length > 0) {
            console.log(`   ❌ Found ${containersToProcess.length} containers but extracted 0 products`);
            console.log(`   📝 First container HTML sample:`);
            console.log(containersToProcess[0]?.innerHTML?.substring(0, 500));
          }
          break; // Try next query variation
        }
        
      } catch (error: any) {
        lastError = error;
        if (retries > 0) {
          console.log(`⚠️ Error, retrying... (${retries} left)`);
          retries--;
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        console.error(`❌ Error after retries:`, error.message);
        break; // Try next query variation
      }
    }
    
    // If we got products from this query, stop trying variations
    if (allProducts.length > 0) {
      break;
    }
  }
  
  // Sort by similarity DESC, keep top 20
  return allProducts
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 20);
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
    const failedMarketplaces: string[] = [];
    let foundValidProducts = false;

    // ✅ FIX 1: PARALLELIZE MARKETPLACE SCRAPING
    console.log(`\n🚀 Starting parallel scraping of ${marketplaceKeys.length} marketplaces...`);
    
    const scrapePromises = marketplaceKeys.map(async (marketplaceKey) => {
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
        
        // 🆕 FILTER MODEL MISMATCHES for electronics
        if (baseline.category === 'Electronics & Technology' && products.length > 0) {
          const beforeModelFilter = products.length;
          products = products.filter(product => {
            const isMismatch = isModelMismatch(baseline.product_name, product.name);
            if (isMismatch) {
              console.log(`⏭️ Filtered model mismatch: "${product.name.slice(0, 60)}..."`);
            }
            return !isMismatch;
          });
          console.log(`🔍 Model filtering: ${beforeModelFilter} products → ${products.length} products (removed ${beforeModelFilter - products.length} wrong models)`);
        }
        
        // ✅ FIX 4: BATCH AI VALIDATION - Run in parallel batches of 5
        if (products.length > 0) {
          const mediumConfidenceProducts = products.filter(p => p.similarity >= 0.30 && p.similarity < 0.80);
          
          if (mediumConfidenceProducts.length > 0) {
            console.log(`\n🤖 Running AI validation on ${mediumConfidenceProducts.length} medium-confidence products (batches of 5)...`);
            
            // Process in batches of 5
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
                    console.log(`   ⚠️ AI validation error for "${product.name.slice(0, 50)}..."`);
                    return;
                  }
                  
                  // ✅ FIX 2: NORMALIZE AI DECISION (handle DIFFERENT, different_product, etc.)
                  const decision = validationResult?.decision?.toLowerCase().replace(/_/g, '');
                  if (decision === 'accessory' || decision === 'differentproduct' || decision === 'different') {
                    console.log(`   🤖 AI filtered: "${product.name.slice(0, 50)}..." → ${validationResult.decision}`);
                    product.similarity = -1; // Mark for removal
                  }
                } catch (e) {
                  console.log(`   ⚠️ AI validation exception: ${e}`);
                }
              }));
            }
            
            // Remove AI-filtered products
            const beforeAiFilter = products.length;
            products = products.filter(p => p.similarity >= 0);
            if (beforeAiFilter > products.length) {
              console.log(`🤖 AI filtering: ${beforeAiFilter} → ${products.length} products (removed ${beforeAiFilter - products.length})`);
            }
          }
        }
        
        // ✅ FIX 3: MINIMUM SIMILARITY THRESHOLD - Only save products >= 60%
        if (products.length > 0) {
          const beforeSimilarityFilter = products.length;
          products = products.filter(p => p.similarity >= 0.60);
          if (beforeSimilarityFilter > products.length) {
            console.log(`🎯 Similarity filter: ${beforeSimilarityFilter} → ${products.length} products (removed ${beforeSimilarityFilter - products.length} below 60%)`);
          }
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
          
          // ✅ FIX 5: CONSISTENT AVERAGE - Only use high similarity products (>= 60%)
          const highSimilarityProducts = products.filter(p => p.similarity >= 0.60);
          const prices = highSimilarityProducts.map(p => p.price);
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
            products_found: highSimilarityProducts.length,
            fetch_status: 'success'
          });
          
          return {
            marketplace: config.name,
            status: 'success',
            products_found: highSimilarityProducts.length,
            lowest,
            average,
            highest
          };
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
          
          return {
            marketplace: config.name,
            status: 'no_data'
          };
        }
        
      } catch (error: any) {
        console.error(`Error with ${marketplaceKey}:`, error);
        
        await supabase.from('competitor_prices').insert({
          baseline_id,
          merchant_id: baseline.merchant_id,
          marketplace: marketplaceKey,
          currency: baseline.currency,
          fetch_status: 'failed'
        });
        
        return {
          marketplace: marketplaceKey,
          status: 'failed',
          error: error?.message || 'Unknown error'
        };
      }
    });
    
    // Wait for all marketplaces to complete (in parallel)
    const allResults = await Promise.allSettled(scrapePromises);
    
    // Process results
    for (const result of allResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
        if (result.value.status === 'success') {
          console.log(`✓ ${result.value.marketplace}: ${result.value.products_found} products: ${result.value.lowest?.toFixed(2)}-${result.value.highest?.toFixed(2)} ${baseline.currency}`);
        } else {
          console.log(`✗ ${result.value.marketplace}: ${result.value.status}`);
        }
      } else if (result.status === 'rejected') {
        console.error(`❌ Marketplace scraping rejected:`, result.reason);
      }
    }
    
    console.log(`\n✅ Parallel scraping complete: ${results.length} marketplaces processed`)

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
        // ✅ Try both Google Shopping and Google SERP
        let googleProducts: ScrapedProduct[] = [];
        
        // First try Google Shopping (more product-focused)
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
          // Fallback to regular Google SERP
          console.log(`⚠️ Google Shopping returned 0, trying regular SERP...`);
          googleProducts = await scrapeGoogleSERP(
            coreProductName,
            baseline.current_price,
            baseline.currency,
            baseline.product_name
          );
        }
        
        // Apply accessory filtering
        if (!baselineIsAccessory && googleProducts.length > 0) {
          const beforeFilter = googleProducts.length;
          googleProducts = googleProducts.filter(product => !isAccessoryOrReplacement(product.name));
          console.log(`🔍 Google filtering: ${beforeFilter} → ${googleProducts.length} products`);
        }
        
        // Apply model mismatch filtering for electronics
        if (baseline.category === 'Electronics & Technology' && googleProducts.length > 0) {
          const beforeModelFilter = googleProducts.length;
          googleProducts = googleProducts.filter(product => !isModelMismatch(baseline.product_name, product.name));
          console.log(`🔍 Google model filtering: ${beforeModelFilter} → ${googleProducts.length} products`);
        }
        
        // ✅ FIX 3: Apply 60% similarity threshold to Google products too
        if (googleProducts.length > 0) {
          const beforeSimilarityFilter = googleProducts.length;
          googleProducts = googleProducts.filter(p => p.similarity >= 0.60);
          if (beforeSimilarityFilter > googleProducts.length) {
            console.log(`🎯 Google similarity filter: ${beforeSimilarityFilter} → ${googleProducts.length} products (removed ${beforeSimilarityFilter - googleProducts.length} below 60%)`);
          }
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
          
          // ✅ FIX 5: Only use high similarity products for average
          const highSimilarityProducts = googleProducts.filter(p => p.similarity >= 0.60);
          const prices = highSimilarityProducts.map(p => p.price);
          await supabase.from('competitor_prices').insert({
            baseline_id,
            merchant_id: baseline.merchant_id,
            marketplace: 'google-shopping',
            lowest_price: Math.min(...prices),
            average_price: prices.reduce((a, b) => a + b, 0) / prices.length,
            highest_price: Math.max(...prices),
            currency: baseline.currency,
            products_found: highSimilarityProducts.length,
            fetch_status: 'success'
          });
          
          results.push({
            marketplace: 'Google Shopping (Fallback)',
            status: 'success',
            products_found: highSimilarityProducts.length
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
