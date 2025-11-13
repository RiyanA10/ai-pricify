import { useState, useEffect } from "react";
import { ArrowLeft, TrendingUp, Target, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export const CompetitiveIntelligencePage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [competitorData, setCompetitorData] = useState<any[]>([]);
  const [metrics, setMetrics] = useState({
    marketLeader: '',
    avgPriceGap: 0,
    activeCompetitors: 0,
    priceUpdates: 0
  });

  useEffect(() => {
    fetchCompetitorData();
  }, []);

  const fetchCompetitorData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // First, get active baseline IDs
      const { data: activeBaselines } = await supabase
        .from('product_baselines')
        .select('id')
        .eq('merchant_id', user.id)
        .is('deleted_at', null);

      const activeBaselineIds = activeBaselines?.map(b => b.id) || [];

      // If no active baselines, clear all data
      if (activeBaselineIds.length === 0) {
        setCompetitorData([]);
        setMetrics({
          marketLeader: '',
          avgPriceGap: 0,
          activeCompetitors: 0,
          priceUpdates: 0
        });
        setLoading(false);
        return;
      }

      // Fetch competitor prices only for active products
      const { data: competitors } = await supabase
        .from('competitor_prices')
        .select('*')
        .eq('merchant_id', user.id)
        .in('baseline_id', activeBaselineIds)
        .order('last_updated', { ascending: false });

      if (competitors && competitors.length > 0) {
        // Group by marketplace and aggregate data
        const marketplaceData = competitors.reduce((acc: any, comp) => {
          if (!acc[comp.marketplace]) {
            acc[comp.marketplace] = {
              name: comp.marketplace,
              avgPrice: 0,
              count: 0,
              totalPrice: 0,
              lastUpdated: comp.last_updated
            };
          }
          acc[comp.marketplace].totalPrice += Number(comp.average_price) || 0;
          acc[comp.marketplace].count += 1;
          return acc;
        }, {});

        const competitorList = Object.values(marketplaceData).map((m: any) => ({
          ...m,
          avgPrice: m.count > 0 ? m.totalPrice / m.count : 0
        }));

        setCompetitorData(competitorList);

        // Calculate metrics
        const totalCompetitors = competitorList.length;
        const avgMarketPrice = competitorList.reduce((sum: number, c: any) => sum + c.avgPrice, 0) / totalCompetitors;
        
        // Fetch user's average price
        const { data: baselines } = await supabase
          .from('product_baselines')
          .select('current_price')
          .eq('merchant_id', user.id)
          .is('deleted_at', null);

        const userAvgPrice = baselines && baselines.length > 0
          ? baselines.reduce((sum, b) => sum + Number(b.current_price), 0) / baselines.length
          : 0;

        const priceGap = avgMarketPrice > 0 ? ((userAvgPrice - avgMarketPrice) / avgMarketPrice) * 100 : 0;

        setMetrics({
          marketLeader: competitorList[0]?.name || 'N/A',
          avgPriceGap: priceGap,
          activeCompetitors: totalCompetitors,
          priceUpdates: competitors.filter(c => {
            const lastUpdate = new Date(c.last_updated);
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            return lastUpdate > oneDayAgo;
          }).length
        });
      }

      setLoading(false);
    } catch (error) {
      console.error('Error fetching competitor data:', error);
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get all active baselines
      const { data: baselines } = await supabase
        .from('product_baselines')
        .select('id')
        .eq('merchant_id', user.id)
        .is('deleted_at', null);

      if (!baselines || baselines.length === 0) {
        toast({
          title: "No Products Found",
          description: "Please upload products first to fetch competitor data.",
          variant: "destructive"
        });
        setRefreshing(false);
        return;
      }

      // Call refresh function for each baseline
      let successCount = 0;
      for (const baseline of baselines) {
        const { data: { session } } = await supabase.auth.getSession();
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-competitors`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session?.access_token}`
            },
            body: JSON.stringify({ baseline_id: baseline.id })
          }
        );

        if (response.ok) successCount++;
      }

      toast({
        title: "Competitor Data Refreshed",
        description: `Successfully refreshed data for ${successCount} product(s).`
      });

      // Reload the data
      await fetchCompetitorData();
    } catch (error) {
      console.error('Error refreshing competitor data:', error);
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh competitor data. Please try again.",
        variant: "destructive"
      });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="hover:bg-muted/50"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          
          <Button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing...' : 'Refresh Competitor Data'}
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
            Competitive Intelligence
          </h1>
          <p className="text-muted-foreground">
            Track competitor pricing strategies and identify market opportunities
          </p>
        </div>

        {/* Market Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Market Leader</div>
            <div className="text-2xl font-bold text-foreground">{metrics.marketLeader || 'N/A'}</div>
            <div className="text-sm text-muted-foreground mt-1">
              Most active marketplace
            </div>
          </Card>

          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Avg Price Gap</div>
            <div className="text-2xl font-bold text-foreground">
              {metrics.avgPriceGap > 0 ? '+' : ''}{metrics.avgPriceGap.toFixed(1)}%
            </div>
            <div className={`text-sm flex items-center gap-1 mt-1 ${
              Math.abs(metrics.avgPriceGap) > 15 ? 'text-destructive' : 'text-success'
            }`}>
              <Target className="h-4 w-4" />
              {metrics.avgPriceGap > 0 ? 'Above' : 'Below'} market
            </div>
          </Card>

          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Active Competitors</div>
            <div className="text-2xl font-bold text-foreground">{metrics.activeCompetitors}</div>
            <div className="text-sm text-muted-foreground mt-1">
              Tracked platforms
            </div>
          </Card>

          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Price Updates</div>
            <div className="text-2xl font-bold text-foreground">{metrics.priceUpdates}</div>
            <div className="text-sm text-info flex items-center gap-1 mt-1">
              <TrendingUp className="h-4 w-4" />
              Last 24 hours
            </div>
          </Card>
        </div>

        {/* Competitor Analysis */}
        <Card className="mb-8 bg-card/50 backdrop-blur border-border/50">
          <div className="p-6 border-b border-border/50">
            <h2 className="text-2xl font-semibold text-foreground">Competitor Overview</h2>
            <p className="text-muted-foreground mt-1">Track pricing across different marketplaces</p>
          </div>
          <div className="p-6">
            {competitorData.length > 0 ? (
              <div className="grid gap-4">
                {competitorData.map((competitor, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-lg font-bold text-primary">
                          {competitor.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">{competitor.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {competitor.count} product{competitor.count !== 1 ? 's' : ''} tracked
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold text-foreground">
                        {competitor.avgPrice.toFixed(2)}
                      </div>
                      <div className="text-sm text-muted-foreground">Avg Price</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-muted/20 rounded-lg">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-2">No Competitor Data</h3>
                <p className="text-muted-foreground mb-4">
                  Click "Refresh Competitor Data" to fetch the latest pricing information
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Market Insights */}
        <Card className="bg-card/50 backdrop-blur border-border/50">
          <div className="p-6 border-b border-border/50">
            <h2 className="text-2xl font-semibold text-foreground">Market Insights</h2>
            <p className="text-muted-foreground mt-1">AI-powered recommendations based on competitor analysis</p>
          </div>
          <div className="p-6 space-y-4">
            {competitorData.length > 0 ? (
              <>
                <div className="p-4 rounded-lg border border-success/20 bg-success/5">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center flex-shrink-0 mt-1">
                      <TrendingUp className="h-4 w-4 text-success" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-foreground">Competitive Positioning</h3>
                        <Badge variant="outline" className="text-xs">Active</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Your pricing is being monitored across {metrics.activeCompetitors} marketplace{metrics.activeCompetitors !== 1 ? 's' : ''}. 
                        Maintain competitive prices to maximize market share.
                      </p>
                    </div>
                  </div>
                </div>
                
                {Math.abs(metrics.avgPriceGap) > 15 && (
                  <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0 mt-1">
                        <AlertCircle className="h-4 w-4 text-destructive" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground">Price Gap Alert</h3>
                          <Badge variant="destructive" className="text-xs">High Impact</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Your average price is {Math.abs(metrics.avgPriceGap).toFixed(1)}% {metrics.avgPriceGap > 0 ? 'above' : 'below'} market average. 
                          Consider adjusting your pricing strategy to remain competitive.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No insights available. Refresh competitor data to generate insights.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
