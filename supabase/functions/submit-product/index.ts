import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ProductSchema = z.object({
  product_name: z.string().min(1, 'Product name is required'),
  category: z.string().min(1, 'Category is required'),
  current_price: z.number().positive('Price must be positive'),
  current_quantity: z.number().int().positive('Quantity must be positive'),
  cost_per_unit: z.number().positive('Cost must be positive'),
  currency: z.enum(['SAR', 'USD']),
  base_elasticity: z.number(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Use service role to bypass RLS for both guest and authenticated users
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Check if user is authenticated (optional)
    let merchantId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (!authError && user) {
        merchantId = user.id;
        console.log(`✅ Authenticated submission from user: ${user.email}`);
      }
    }
    
    if (!merchantId) {
      console.log('👤 Guest submission - no authentication');
    }

    // Parse and validate request body
    const body = await req.json();
    const validation = ProductSchema.safeParse(body);
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: validation.error.issues }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const productData = validation.data;

    // Validate cost < price
    if (productData.cost_per_unit >= productData.current_price) {
      return new Response(
        JSON.stringify({ error: 'Cost per unit must be less than current price' }), 
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert product baseline using service role (bypasses RLS)
    const { data: insertedProduct, error: insertError } = await supabase
      .from('product_baselines')
      .insert({
        merchant_id: merchantId, // null for guests, user.id for authenticated
        product_name: productData.product_name,
        category: productData.category,
        current_price: productData.current_price,
        current_quantity: productData.current_quantity,
        cost_per_unit: productData.cost_per_unit,
        currency: productData.currency,
        base_elasticity: productData.base_elasticity,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    console.log(`📦 Product created: ${insertedProduct.id} (${merchantId ? 'authenticated' : 'guest'})`);

    // Create initial processing status
    await supabase.from('processing_status').insert({
      baseline_id: insertedProduct.id,
      status: 'pending',
      current_step: 'queued'
    });

    // Trigger process-pricing edge function (fire and forget style via background)
    const backgroundTask = (async () => {
      try {
        console.log('🚀 Triggering process-pricing for baseline:', insertedProduct.id);
        
        const { error: processError } = await supabase.functions.invoke('process-pricing', {
          body: { baseline_id: insertedProduct.id }
        });

        if (processError) {
          console.error('❌ Process-pricing trigger error:', processError);
          // Update status to failed
          await supabase.from('processing_status')
            .update({ status: 'failed', error_message: processError.message })
            .eq('baseline_id', insertedProduct.id);
        }
      } catch (e: any) {
        console.error('❌ Background task error:', e.message);
        await supabase.from('processing_status')
          .update({ status: 'failed', error_message: e.message })
          .eq('baseline_id', insertedProduct.id);
      }
    })();

    // Use EdgeRuntime.waitUntil if available
    const edgeRuntime = (globalThis as any).EdgeRuntime;
    if (edgeRuntime?.waitUntil) {
      edgeRuntime.waitUntil(backgroundTask);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        baseline_id: insertedProduct.id,
        is_guest: merchantId === null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[Internal] Submit-product error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to submit product' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
