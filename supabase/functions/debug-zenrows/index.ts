import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url, marketplace } = await req.json();
    
    const scrapingbeeApiKey = Deno.env.get('SCRAPINGBEE_API_KEY');
    
    if (!scrapingbeeApiKey) {
      throw new Error('SCRAPINGBEE_API_KEY not configured');
    }
    
    console.log(`🐝 ScrapingBee: Fetching ${marketplace} from: ${url}`);
    
    // Determine country code based on URL
    const countryCode = url.includes('.sa') || url.includes('noon.com') || url.includes('extra.com') || url.includes('jarir.com') ? 'sa' : 'us';
    
    const scrapingbeeUrl = new URL('https://app.scrapingbee.com/api/v1/');
    scrapingbeeUrl.searchParams.set('api_key', scrapingbeeApiKey);
    scrapingbeeUrl.searchParams.set('url', url);
    scrapingbeeUrl.searchParams.set('render_js', 'true');
    scrapingbeeUrl.searchParams.set('wait', '3000');
    scrapingbeeUrl.searchParams.set('wait_browser', 'load');
    scrapingbeeUrl.searchParams.set('premium_proxy', 'true');
    scrapingbeeUrl.searchParams.set('country_code', countryCode);
    scrapingbeeUrl.searchParams.set('block_ads', 'true');
    scrapingbeeUrl.searchParams.set('block_resources', 'true');
    scrapingbeeUrl.searchParams.set('return_page_source', 'true');
    
    const response = await fetch(scrapingbeeUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'text/html',
      },
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ScrapingBee`);
    }
    
    const html = await response.text();
    
    console.log(`Received ${html.length} characters`);
    
    return new Response(JSON.stringify({
      success: true,
      marketplace,
      url,
      htmlLength: html.length,
      html: html,
      // First 1000 chars preview
      preview: html.substring(0, 1000)
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
