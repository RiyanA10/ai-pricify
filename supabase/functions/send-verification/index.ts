import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

    const { email, business_name, is_resend } = await req.json();

    // Generate 6-digit code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Hash the code using Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(verificationCode);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const codeHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // Check rate limiting (max 3 resends per hour)
    if (is_resend) {
      const { count } = await supabase
        .from('email_verifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

      if (count && count >= 3) {
        return new Response(
          JSON.stringify({ error: "Too many requests. Please try again in an hour." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Invalidate old codes
      await supabase
        .from('email_verifications')
        .update({ verified: true })
        .eq('user_id', user.id)
        .eq('verified', false);
    }

    // Save verification code
    const { error: insertError } = await supabase
      .from('email_verifications')
      .insert({
        user_id: user.id,
        email,
        verification_code: verificationCode,
        code_hash: codeHash,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      throw insertError;
    }

    // Send verification email
    const emailContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 0 auto; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                    color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .code-box { background: white; border: 2px dashed #667eea; padding: 20px; 
                      text-align: center; margin: 20px 0; border-radius: 8px; }
          .code { font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #667eea; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; padding: 20px; }
          .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to AI Truest</h1>
          </div>
          <div class="content">
            <h2>Hello ${business_name || 'there'}!</h2>
            <p>Thank you for registering with AI Truest - Intelligent Pricing Optimization Platform.</p>
            
            <p>To complete your registration and secure your account, please verify your email address using the code below:</p>
            
            <div class="code-box">
              <div style="color: #666; font-size: 14px; margin-bottom: 10px;">Your Verification Code</div>
              <div class="code">${verificationCode}</div>
            </div>
            
            <p><strong>⏱️ This code expires in 15 minutes.</strong></p>
            
            <p>Enter this code on the verification page to activate your account and start optimizing your prices.</p>
            
            <div class="warning">
              <strong>🔒 Security Note:</strong><br/>
              If you didn't create an account with AI Truest, please ignore this email or contact our support team.
            </div>
            
            <p>Need help? Contact us at <a href="mailto:info@paybacksa.com">info@paybacksa.com</a></p>
          </div>
          <div class="footer">
            <p>© 2025 AI Truest, Saudi Arabia. All rights reserved.</p>
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const { error: emailError } = await resend.emails.send({
      from: "AI Truest <onboarding@resend.dev>",
      to: [email],
      subject: "Verify Your Email - AI Truest",
      html: emailContent,
    });

    if (emailError) {
      console.error("Email error:", emailError);
      throw emailError;
    }

    console.log(`✓ Verification email sent to ${email}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Verification code sent",
        code_expires_in: 900 
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