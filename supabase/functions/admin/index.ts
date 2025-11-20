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

      case 'competitor-analytics': {
        // Get all baselines with their competitor data
        const { data: baselines } = await supabase
          .from('product_baselines')
          .select('*')
          .is('deleted_at', null);

        // Get all competitor products
        const { data: competitors } = await supabase
          .from('competitor_products')
          .select('*');

        // Get all competitor prices (aggregated)
        const { data: prices } = await supabase
          .from('competitor_prices')
          .select('*');

        // Get pricing results
        const { data: results } = await supabase
          .from('pricing_results')
          .select('*');

        // Calculate metrics
        const totalUploads = baselines?.length || 0;
        const baselineIds = baselines?.map(b => b.id) || [];
        
        // Competitor distribution
        const competitorsByBaseline = new Map();
        competitors?.forEach(comp => {
          const count = competitorsByBaseline.get(comp.baseline_id) || 0;
          competitorsByBaseline.set(comp.baseline_id, count + 1);
        });

        const distribution = {
          zero: 0,
          one: 0,
          twoToThree: 0,
          fourPlus: 0,
        };

        baselineIds.forEach(id => {
          const count = competitorsByBaseline.get(id) || 0;
          if (count === 0) distribution.zero++;
          else if (count === 1) distribution.one++;
          else if (count <= 3) distribution.twoToThree++;
          else distribution.fourPlus++;
        });

        // Price position analysis
        const pricePosition = {
          muchBelow: 0,
          competitive: 0,
          atMarket: 0,
          aboveMarket: 0,
          muchAbove: 0,
          noData: 0,
        };

        baselines?.forEach(baseline => {
          const result = results?.find(r => r.baseline_id === baseline.id);
          if (!result || !result.market_average) {
            pricePosition.noData++;
            return;
          }

          const ratio = (baseline.current_price / result.market_average - 1) * 100;
          if (ratio <= -20) pricePosition.muchBelow++;
          else if (ratio <= -5) pricePosition.competitive++;
          else if (ratio <= 5) pricePosition.atMarket++;
          else if (ratio <= 20) pricePosition.aboveMarket++;
          else pricePosition.muchAbove++;
        });

        // Data quality metrics
        const allSimilarityScores = competitors?.map(c => c.similarity_score) || [];
        const avgSimilarity = allSimilarityScores.length > 0
          ? allSimilarityScores.reduce((a, b) => a + b, 0) / allSimilarityScores.length
          : 0;

        const warningCount = results?.filter(r => r.has_warning).length || 0;

        // Scraping health
        const totalFetches = prices?.length || 0;
        const successfulFetches = prices?.filter(p => p.fetch_status === 'success').length || 0;
        const failedFetches = prices?.filter(p => p.fetch_status === 'failed').length || 0;

        return new Response(JSON.stringify({
          uploadMetrics: {
            totalUploads,
            withCompetitors: totalUploads - distribution.zero,
            withoutCompetitors: distribution.zero,
            avgCompetitorsPerProduct: competitors?.length ? (competitors.length / totalUploads).toFixed(1) : 0,
          },
          distribution: {
            zero: distribution.zero,
            one: distribution.one,
            twoToThree: distribution.twoToThree,
            fourPlus: distribution.fourPlus,
          },
          pricePosition,
          scrapingHealth: {
            totalFetches,
            successfulFetches,
            failedFetches,
            successRate: totalFetches > 0 ? ((successfulFetches / totalFetches) * 100).toFixed(1) : 0,
          },
          dataQuality: {
            avgSimilarity: avgSimilarity.toFixed(2),
            totalCompetitors: competitors?.length || 0,
            productsWithWarnings: warningCount,
          },
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'product-competitor-details': {
        // Get all baselines with their full details
        const { data: baselines } = await supabase
          .from('product_baselines')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        // Get auth users for merchant emails
        const { data: authUsers } = await supabase.auth.admin.listUsers();

        // Get all competitor products
        const { data: allCompetitors } = await supabase
          .from('competitor_products')
          .select('*');

        // Get pricing results to see which were used
        const { data: pricingResults } = await supabase
          .from('pricing_results')
          .select('*');

        const productDetails = baselines?.map(baseline => {
          const merchant = authUsers?.users.find(u => u.id === baseline.merchant_id);
          const competitors = allCompetitors?.filter(c => c.baseline_id === baseline.id) || [];
          const result = pricingResults?.find(r => r.baseline_id === baseline.id);

          // Top 5 competitors by rank are typically used in calculations
          const usedCompetitors = competitors
            .filter(c => c.rank <= 5)
            .sort((a, b) => a.rank - b.rank);

          const filteredCompetitors = competitors
            .filter(c => c.rank > 5)
            .map(c => ({
              ...c,
              filterReason: getFilterReason(c, baseline),
            }));

          return {
            baseline: {
              id: baseline.id,
              product_name: baseline.product_name,
              current_price: baseline.current_price,
              currency: baseline.currency,
              category: baseline.category,
              created_at: baseline.created_at,
              merchant_email: merchant?.email || 'Unknown',
            },
            totalCompetitors: competitors.length,
            usedCompetitors: usedCompetitors.map(c => ({
              product_name: c.product_name,
              price: c.price,
              marketplace: c.marketplace,
              similarity_score: c.similarity_score,
              price_ratio: c.price_ratio,
              rank: c.rank,
              product_url: c.product_url,
            })),
            filteredCompetitors: filteredCompetitors.map(c => ({
              product_name: c.product_name,
              price: c.price,
              marketplace: c.marketplace,
              similarity_score: c.similarity_score,
              price_ratio: c.price_ratio,
              rank: c.rank,
              product_url: c.product_url,
              filterReason: c.filterReason,
            })),
            marketData: result ? {
              market_average: result.market_average,
              market_lowest: result.market_lowest,
              market_highest: result.market_highest,
              suggested_price: result.suggested_price,
            } : null,
          };
        }) || [];

        return new Response(JSON.stringify({ productDetails }), {
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

// Helper function to determine why a competitor was filtered
function getFilterReason(competitor: any, baseline: any): string {
  const reasons: string[] = [];
  
  if (competitor.similarity_score < 0.5) {
    reasons.push('Low similarity score');
  }
  
  if (competitor.price_ratio > 3 || competitor.price_ratio < 0.33) {
    reasons.push('Extreme price difference');
  }
  
  if (competitor.rank > 10) {
    reasons.push('Low rank position');
  }
  
  return reasons.length > 0 ? reasons.join(', ') : 'Outside top 5';
}
