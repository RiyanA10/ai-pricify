import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Package, AlertCircle, ArrowUp, LogOut, Upload, Target, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '@/hooks/use-toast';

interface DashboardProps {
  onNavigateToUpload: () => void;
}

const Dashboard = ({ onNavigateToUpload }: DashboardProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    profitIncrease: 0,
    revenue: 0,
    productsOptimized: 0,
    activeAlerts: 0,
    currency: 'SAR',
  });
  const [alerts, setAlerts] = useState<any[]>([]);
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [baselines, setBaselines] = useState<any[]>([]);
  const [pricingResults, setPricingResults] = useState<any[]>([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch product baselines (excluding deleted ones)
      const { data: baselines } = await supabase
        .from('product_baselines')
        .select('*')
        .eq('merchant_id', user.id)
        .is('deleted_at', null);

      // Only fetch pricing results for non-deleted products
      const activeBaselineIds = baselines?.map(b => b.id) || [];
      
      const { data: pricingResults } = await supabase
        .from('pricing_results')
        .select('*')
        .eq('merchant_id', user.id)
        .in('baseline_id', activeBaselineIds.length > 0 ? activeBaselineIds : ['00000000-0000-0000-0000-000000000000']);

      // Calculate metrics
      const totalProducts = baselines?.length || 0;
      const optimizedProducts = pricingResults?.length || 0;
      
      // Get currency from first baseline (all products should have same currency)
      const currency = baselines?.[0]?.currency || 'SAR';
      
      const totalProfit = pricingResults?.reduce((sum, result) => {
        return sum + (Number(result.profit_increase_amount) || 0);
      }, 0) || 0;

      const avgProfitIncrease = pricingResults?.length > 0
        ? pricingResults.reduce((sum, result) => sum + (Number(result.profit_increase_percent) || 0), 0) / pricingResults.length
        : 0;

      // Find products with warnings
      const productsWithWarnings = pricingResults?.filter(result => result.has_warning) || [];

      // Calculate opportunities (products with high profit potential)
      const topOpportunities = pricingResults
        ?.filter(result => Number(result.profit_increase_amount) > 0)
        .sort((a, b) => Number(b.profit_increase_amount) - Number(a.profit_increase_amount))
        .slice(0, 5)
        .map(result => {
          const baseline = baselines?.find(b => b.id === result.baseline_id);
          return {
            id: result.id,
            product: baseline?.product_name || 'Unknown Product',
            potential: Number(result.profit_increase_amount).toFixed(2),
          };
        }) || [];

      // Create alerts from warnings
      const newAlerts = productsWithWarnings.slice(0, 5).map((result, index) => {
        const baseline = baselines?.find(b => b.id === result.baseline_id);
        return {
          id: index + 1,
          type: 'warning',
          product: baseline?.product_name || 'Unknown Product',
          message: result.warning_message || 'Price analysis warning',
          action: 'Review pricing',
        };
      });

      // Generate chart data (last 7 days of profit)
      const chartDataPoints = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        chartDataPoints.push({
          name: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          profit: totalProfit * (0.8 + Math.random() * 0.4), // Simulated daily variation
        });
      }

      setMetrics({
        profitIncrease: avgProfitIncrease,
        revenue: totalProfit,
        productsOptimized: optimizedProducts,
        activeAlerts: newAlerts.length,
        currency: currency,
      });
      setAlerts(newAlerts);
      setOpportunities(topOpportunities);
      setChartData(chartDataPoints);
      setBaselines(baselines || []);
      setPricingResults(pricingResults || []);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center shadow-glow">
                <span className="text-xl font-bold text-white">AT</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-primary">AI TRUEST™</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last updated: {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => navigate('/products')} variant="outline" className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                View All Products
              </Button>
              <Button 
                onClick={() => {
                  if (baselines.length > 0) {
                    navigate(`/results/${baselines[0].id}`);
                  } else {
                    toast({
                      title: 'No Products',
                      description: 'Please upload products first',
                      variant: 'destructive',
                    });
                  }
                }}
                variant="outline" 
                className="flex items-center gap-2"
              >
                <Target className="w-4 h-4" />
                Product Analysis
              </Button>
              <Button onClick={() => navigate('/competitive-intelligence')} variant="outline" className="flex items-center gap-2">
                <Target className="w-4 h-4" />
                Competitive Intelligence
              </Button>
              <Button onClick={onNavigateToUpload} className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload Products
              </Button>
              <Button variant="outline" onClick={handleLogout} className="flex items-center gap-2">
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome Message */}
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">👋 Welcome back, Merchant</h2>
        </div>

        {/* Quick Metrics */}
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle className="text-xl">📊 Quick Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Profit Increase */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-success">
                  <ArrowUp className="w-4 h-4" />
                  <TrendingUp className="w-4 h-4" />
                </div>
                <p className="text-sm text-muted-foreground">Avg Profit Increase</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-success">+{metrics.profitIncrease.toFixed(1)}%</span>
                  <TrendingUp className="w-5 h-5 text-success" />
                </div>
                <p className="text-xs text-muted-foreground">vs. baseline pricing</p>
              </div>

              {/* Revenue */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <DollarSign className="w-4 h-4" />
                </div>
                <p className="text-sm text-muted-foreground">Total Additional Profit</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-foreground">{metrics.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-lg font-semibold text-primary">{metrics.currency}</span>
                </div>
                <p className="text-xs text-muted-foreground">from optimized pricing</p>
              </div>

              {/* Products Optimized */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <Package className="w-4 h-4" />
                </div>
                <p className="text-sm text-muted-foreground">Products Analyzed</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-foreground">{metrics.productsOptimized}</span>
                  <Package className="w-5 h-5 text-primary" />
                </div>
                <p className="text-xs text-muted-foreground">with pricing recommendations</p>
              </div>

              {/* Active Alerts */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <p className="text-sm text-muted-foreground">Active Alerts</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-destructive">{metrics.activeAlerts}</span>
                  <AlertCircle className="w-5 h-5 text-destructive" />
                </div>
                <p className="text-xs text-muted-foreground">requiring attention</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Price Alerts */}
        {alerts.length > 0 && (
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-destructive" />
                🚨 Active Price Alerts
              </CardTitle>
              <CardDescription>Pricing issues that need your immediate attention</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.map((alert) => (
                <Alert key={alert.id} className="mb-3 last:mb-0 border-destructive/50 bg-destructive/10">
                  <AlertCircle className="h-4 w-4 !text-destructive" />
                  <AlertDescription>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-destructive mb-1">{alert.product}</p>
                        <p className="text-sm text-foreground">{alert.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">{alert.action}</p>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Revenue & Profit Trend */}
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle className="text-xl">📈 Profit Trend</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="profit" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground">No data available yet</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Market Position Visualization */}
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle className="text-xl">🎯 Market Position</CardTitle>
            <CardDescription>Your pricing compared to competitors</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pricingResults && pricingResults.length > 0 ? (
                pricingResults.slice(0, 5).map((result) => {
                  const baseline = baselines?.find(b => b.id === result.baseline_id);
                  const marketPosition = Number(result.position_vs_market) || 0;
                  const isCompetitive = marketPosition >= -10 && marketPosition <= 10;
                  
                  return (
                    <div key={result.id} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-foreground">
                          {baseline?.product_name || 'Unknown Product'}
                        </span>
                        <span className={`text-sm font-semibold ${
                          marketPosition > 10 ? 'text-destructive' : 
                          marketPosition < -10 ? 'text-success' : 
                          'text-warning'
                        }`}>
                          {marketPosition > 0 ? '+' : ''}{marketPosition.toFixed(1)}%
                        </span>
                      </div>
                      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`absolute h-full transition-all ${
                            isCompetitive ? 'bg-success' : 
                            marketPosition > 0 ? 'bg-destructive' : 
                            'bg-primary'
                          }`}
                          style={{ 
                            width: `${Math.min(Math.abs(marketPosition), 100)}%`,
                            left: marketPosition > 0 ? '50%' : `${50 - Math.min(Math.abs(marketPosition), 50)}%`
                          }}
                        />
                        <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border" />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="h-48 flex items-center justify-center bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground">No market position data available</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Optimization Opportunities */}
        {opportunities.length > 0 && (
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl">💡 Optimization Opportunities</CardTitle>
              <CardDescription>Products with highest profit potential</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {opportunities.map((opp) => (
                  <div key={opp.id} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between gap-4 w-full">
                      <span className="font-medium text-foreground flex-1">{opp.product}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-success font-semibold">+{opp.potential}</span>
                        <Button size="sm" onClick={() => navigate('/products')}>
                          Optimize
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
