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
    
    const zenrowsApiKey = Deno.env.get('ZENROWS_API_KEY');
    
    if (!zenrowsApiKey) {
      throw new Error('ZENROWS_API_KEY not configured');
    }
    
    console.log(`Fetching ${marketplace} from: ${url}`);
    
    const zenrowsUrl = new URL('https://api.zenrows.com/v1/');
    zenrowsUrl.searchParams.set('url', url);
    zenrowsUrl.searchParams.set('apikey', zenrowsApiKey);
    zenrowsUrl.searchParams.set('js_render', 'true');
    zenrowsUrl.searchParams.set('premium_proxy', 'true');
    
    const response = await fetch(zenrowsUrl.toString());
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ZenRows`);
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
