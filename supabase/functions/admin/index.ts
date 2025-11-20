import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // Verify admin access
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (roleError || !roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Read action from request body
    const { action } = await req.json();

    if (!action) {
      return new Response(JSON.stringify({ error: 'Action parameter required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    switch (action) {
      case 'list-users': {
        // Get all auth users
        const { data: authUsers, error: usersError } = await supabase.auth.admin.listUsers();
        if (usersError) throw usersError;

        // Get profiles
        const { data: profiles } = await supabase.from('profiles').select('*');

        // Get roles
        const { data: roles } = await supabase.from('user_roles').select('user_id, role');

        const users = authUsers.users.map(authUser => {
          const profile = profiles?.find(p => p.id === authUser.id);
          const userRole = roles?.find(r => r.user_id === authUser.id);
          
          return {
            id: authUser.id,
            email: authUser.email || '',
            business_name: profile?.business_name || null,
            created_at: authUser.created_at,
            role: userRole?.role || 'user',
          };
        });

        return new Response(JSON.stringify({ users }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'list-all-products': {
        // Get all baselines
        const { data: baselines, error: baselinesError } = await supabase
          .from('product_baselines')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (baselinesError) throw baselinesError;

        // Get auth users for emails
        const { data: authUsers } = await supabase.auth.admin.listUsers();

        const products = baselines?.map(baseline => {
          const user = authUsers?.users.find(u => u.id === baseline.merchant_id);
          return {
            id: baseline.id,
            product_name: baseline.product_name,
            current_price: baseline.current_price,
            currency: baseline.currency,
            category: baseline.category,
            created_at: baseline.created_at || '',
            merchant_id: baseline.merchant_id,
            merchant_email: user?.email || 'Unknown',
          };
        }) || [];

        return new Response(JSON.stringify({ products }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'delete-user': {
        const body = await req.clone().json();
        const { userId } = body;
        
        if (!userId) {
          return new Response(JSON.stringify({ error: 'User ID required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
        if (deleteError) throw deleteError;

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'stats': {
        // Get counts
        const { count: usersCount } = await supabase
          .from('profiles')
          .select('*', { count: 'exact', head: true });

        const { count: productsCount } = await supabase
          .from('product_baselines')
          .select('*', { count: 'exact', head: true })
          .is('deleted_at', null);

        const { count: competitorCount } = await supabase
          .from('competitor_products')
          .select('*', { count: 'exact', head: true });

        // Get recent activity
        const { data: recentBaselines } = await supabase
          .from('product_baselines')
          .select('id, product_name, created_at')
          .order('created_at', { ascending: false })
          .limit(10);

        const recentActivity = recentBaselines?.map(item => ({
          id: item.id,
          action: `Product "${item.product_name}" created`,
          timestamp: item.created_at || '',
        })) || [];

        return new Response(JSON.stringify({
          totalUsers: usersCount || 0,
          totalProducts: productsCount || 0,
          totalCompetitorProducts: competitorCount || 0,
          recentActivity,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ error: 'Invalid action' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('Admin function error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
