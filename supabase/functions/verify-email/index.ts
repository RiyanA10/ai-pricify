import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { code } = await req.json();

    if (!code || code.length !== 6) {
      return new Response(
        JSON.stringify({ error: "Invalid verification code format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get latest unverified verification record
    const { data: verifications, error: fetchError } = await supabase
      .from('email_verifications')
      .select('*')
      .eq('user_id', user.id)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1);

    if (fetchError) {
      console.error("Fetch error:", fetchError);
      throw fetchError;
    }

    if (!verifications || verifications.length === 0) {
      return new Response(
        JSON.stringify({ error: "No pending verification found" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const record = verifications[0];

    // Check if expired
    if (new Date() > new Date(record.expires_at)) {
      return new Response(
        JSON.stringify({ error: "Verification code expired. Please request a new one." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check attempts (max 5)
    if (record.attempts >= 5) {
      return new Response(
        JSON.stringify({ error: "Too many failed attempts. Please request a new code." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Hash submitted code to compare
    const encoder = new TextEncoder();
    const data = encoder.encode(code);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const codeHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Verify code
    if (codeHash !== record.code_hash) {
      // Increment attempts
      await supabase
        .from('email_verifications')
        .update({ attempts: record.attempts + 1 })
        .eq('id', record.id);

      const attemptsLeft = 5 - (record.attempts + 1);
      return new Response(
        JSON.stringify({ error: `Invalid code. ${attemptsLeft} attempts remaining.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark as verified
    await supabase
      .from('email_verifications')
      .update({ 
        verified: true, 
        verified_at: new Date().toISOString() 
      })
      .eq('id', record.id);

    await supabase
      .from('profiles')
      .update({ 
        email_verified: true, 
        email_verified_at: new Date().toISOString() 
      })
      .eq('id', user.id);

    console.log(`✓ Email verified for user ${user.id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Email verified successfully! You can now log in." 
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});