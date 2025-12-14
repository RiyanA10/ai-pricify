import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Package, AlertCircle, ArrowUp, LogOut, Upload, Target, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useToast } from '@/hooks/use-toast';
import { formatNumber, formatPrice } from '@/lib/utils';
interface DashboardProps {
  onNavigateToUpload: () => void;
}
const Dashboard = ({
  onNavigateToUpload
}: DashboardProps) => {
  const navigate = useNavigate();
  const {
    toast
  } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState({
    profitIncrease: 0,
    revenue: 0,
    productsOptimized: 0,
    activeAlerts: 0,
    currency: 'SAR'
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
      const {
        data: {
          user
        }
      } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch product baselines (excluding deleted ones)
      const {
        data: baselines
      } = await supabase.from('product_baselines').select('*').eq('merchant_id', user.id).is('deleted_at', null);

      // Only fetch pricing results for non-deleted products
      const activeBaselineIds = baselines?.map(b => b.id) || [];
      const {
        data: pricingResults
      } = await supabase.from('pricing_results').select('*').eq('merchant_id', user.id).in('baseline_id', activeBaselineIds.length > 0 ? activeBaselineIds : ['00000000-0000-0000-0000-000000000000']);

      // Calculate metrics
      const totalProducts = baselines?.length || 0;
      const optimizedProducts = pricingResults?.length || 0;

      // Get currency from first baseline (all products should have same currency)
      const currency = baselines?.[0]?.currency || 'SAR';
      const totalProfit = pricingResults?.reduce((sum, result) => {
        return sum + (Number(result.profit_increase_amount) || 0);
      }, 0) || 0;
      const avgProfitIncrease = pricingResults?.length > 0 ? pricingResults.reduce((sum, result) => sum + (Number(result.profit_increase_percent) || 0), 0) / pricingResults.length : 0;

      // Find products with warnings
      const productsWithWarnings = pricingResults?.filter(result => result.has_warning) || [];

      // Calculate opportunities (products with high profit potential)
      const topOpportunities = pricingResults?.filter(result => Number(result.profit_increase_amount) > 0).sort((a, b) => Number(b.profit_increase_amount) - Number(a.profit_increase_amount)).slice(0, 5).map(result => {
        const baseline = baselines?.find(b => b.id === result.baseline_id);
        return {
                      id: result.id,
                      product: baseline?.product_name || 'Unknown Product',
                      potential: formatNumber(Number(result.profit_increase_amount), 2)
                    };
      }) || [];

      // Create alerts from warnings - deduplicate by baseline_id
      const uniqueWarnings = productsWithWarnings.reduce((acc: any[], result) => {
        const existingIndex = acc.findIndex(r => r.baseline_id === result.baseline_id);
        if (existingIndex === -1) {
          acc.push(result);
        } else {
          // Keep the most recent warning for each product
          if (new Date(result.created_at) > new Date(acc[existingIndex].created_at)) {
            acc[existingIndex] = result;
          }
        }
        return acc;
      }, []);
      const newAlerts = uniqueWarnings.slice(0, 5).map((result, index) => {
        const baseline = baselines?.find(b => b.id === result.baseline_id);
        return {
          id: index + 1,
          type: 'warning',
          product: baseline?.product_name || 'Unknown Product',
          message: result.warning_message || 'Price analysis warning',
          action: 'Review pricing'
        };
      });

      // Generate chart data (last 7 days of profit)
      const chartDataPoints = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        chartDataPoints.push({
          name: date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          }),
          profit: totalProfit * (0.8 + Math.random() * 0.4) // Simulated daily variation
        });
      }
      setMetrics({
        profitIncrease: avgProfitIncrease,
        revenue: totalProfit,
        productsOptimized: optimizedProducts,
        activeAlerts: newAlerts.length,
        currency: currency
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
    return <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>;
  }
  return (
    <div className="min-h-screen bg-background">
      {/* Header - Consistent styling with all pages */}
      <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            {/* Logo section */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-glow">
                <span className="text-xl font-bold text-primary-foreground">AT</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-primary">AI TRUEST™</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last updated: {new Date().toLocaleTimeString()}
                </p>
              </div>
            </div>

            {/* Navigation buttons with consistent sizing */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => navigate('/products')}
                variant="outline"
                size="default"
                className="flex items-center gap-2"
              >
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
                size="default"
                className="flex items-center gap-2"
              >
                <Target className="w-4 h-4" />
                Product Analysis
              </Button>
              <Button
                onClick={() => navigate('/competitive-intelligence')}
                variant="outline"
                size="default"
                className="flex items-center gap-2"
              >
                <Target className="w-4 h-4" />
                Competitive Intelligence
              </Button>
              <Button
                onClick={onNavigateToUpload}
                variant="default"
                size="default"
                className="flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Upload Products
              </Button>
              <Button
                variant="outline"
                size="default"
                onClick={handleLogout}
                className="flex items-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

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
                  <span className="text-3xl font-bold text-success">+{formatNumber(metrics.profitIncrease, 1)}%</span>
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
                  <span className="text-3xl font-bold text-foreground">{formatNumber(metrics.revenue, 2)}</span>
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
                  <span className="text-3xl font-bold text-foreground">{formatNumber(metrics.productsOptimized, 0)}</span>
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
                  <span className="text-3xl font-bold text-destructive">{formatNumber(metrics.activeAlerts, 0)}</span>
                  <AlertCircle className="w-5 h-5 text-destructive" />
                </div>
                <p className="text-xs text-muted-foreground">requiring attention</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Price Alerts */}
        {alerts.length > 0 && <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-destructive" />
                🚨 Active Price Alerts
              </CardTitle>
              <CardDescription>Pricing issues that need your immediate attention</CardDescription>
            </CardHeader>
            <CardContent>
              {alerts.map(alert => <Alert key={alert.id} className="mb-3 last:mb-0 border-destructive/50 bg-destructive/10">
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
                </Alert>)}
            </CardContent>
          </Card>}

        {/* Revenue & Profit Trend */}
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle className="text-xl">📈 Profit Trend</CardTitle>
            <CardDescription>Last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {chartData.length > 0 ? <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }} />
                    <Line type="monotone" dataKey="profit" stroke="hsl(var(--primary))" strokeWidth={2} dot={{
                  fill: 'hsl(var(--primary))'
                }} />
                  </LineChart>
                </ResponsiveContainer> : <div className="h-full flex items-center justify-center bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground">No data available yet</p>
                </div>}
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
            <div className="space-y-3">
              {pricingResults && pricingResults.length > 0 ? pricingResults.slice(0, 5).map(result => {
              const baseline = baselines?.find(b => b.id === result.baseline_id);
              const marketPosition = Number(result.position_vs_market) || 0;
              const currentPrice = Number(baseline?.current_price) || 0;
              const marketAvg = Number(result.market_average) || 0;
              const marketLow = Number(result.market_lowest) || 0;
              const marketHigh = Number(result.market_highest) || 0;
              const isUnderpriced = marketPosition < -10;
              const isOverpriced = marketPosition > 10;
              const isCompetitive = !isUnderpriced && !isOverpriced;
              return <div key={result.id} className={`p-4 rounded-lg border transition-all hover:shadow-md ${isCompetitive ? 'bg-success/5 border-success/30' : isOverpriced ? 'bg-destructive/5 border-destructive/30' : 'bg-primary/5 border-primary/30'}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold text-foreground mb-1">
                            {baseline?.product_name || 'Unknown Product'}
                          </h4>
                          <p className="text-xs text-muted-foreground">
                            {isCompetitive && '✓ Competitively priced'}
                            {isOverpriced && '⚠ Above market average'}
                            {isUnderpriced && '↗ Underpriced opportunity'}
                          </p>
                        </div>
                        <div className={`text-right ml-4 ${isOverpriced ? 'text-destructive' : isUnderpriced ? 'text-primary' : 'text-success'}`}>
                          <div className="text-lg font-bold">
                            {marketPosition > 0 ? '+' : ''}{formatNumber(marketPosition, 1)}%
                          </div>
                          <div className="text-xs opacity-70">vs market</div>
                        </div>
                      </div>
                      
                      {/* Visual price comparison */}
                      <div className="relative">
                        <div className="flex items-center gap-2 text-[10px] lg:text-xs">
                          <span>Low: {formatPrice(marketLow, baseline.currency)}</span>
                          <span>Avg: {formatPrice(marketAvg, baseline.currency)}</span>
                          <span>High: {formatPrice(marketHigh, baseline.currency)}</span>
                        </div>
                        <div className="relative h-3 bg-gradient-to-r from-success/20 via-warning/20 to-destructive/20 rounded-full overflow-hidden">
                          {/* Market range indicator */}
                          <div className="absolute inset-0 flex items-center">
                            <div className="absolute h-full w-1 bg-foreground/20" style={{
                        left: '33%'
                      }} />
                            <div className="absolute h-full w-1 bg-foreground/20" style={{
                        left: '66%'
                      }} />
                          </div>
                          {/* Current price indicator */}
                          {marketLow > 0 && marketHigh > 0 && <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-foreground border-2 border-background shadow-lg" style={{
                      left: `${Math.max(0, Math.min(100, (currentPrice - marketLow) / (marketHigh - marketLow) * 100))}%`,
                      transform: 'translateX(-50%) translateY(-50%)'
                    }} />}
                        </div>
                        <div className="flex justify-center mt-1">
                          <span className="text-xs font-medium text-foreground">
                            Your price: {currentPrice.toFixed(2)} {baseline?.currency}
                          </span>
                        </div>
                      </div>
                    </div>;
            }) : <div className="h-48 flex items-center justify-center bg-muted/30 rounded-lg">
                  <p className="text-muted-foreground">No market position data available</p>
                </div>}
            </div>
          </CardContent>
        </Card>

        {/* Optimization Opportunities */}
        {opportunities.length > 0 && <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl">💡 Optimization Opportunities</CardTitle>
              <CardDescription>Products with highest profit potential</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {opportunities.map(opp => <div key={opp.id} className="flex items-center justify-between p-4 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between gap-4 w-full">
                      <span className="font-medium text-foreground flex-1">{opp.product}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-success font-semibold">+{opp.potential}</span>
                        <Button size="sm" onClick={() => navigate('/products')}>
                          Optimize
                        </Button>
                      </div>
                    </div>
                  </div>)}
              </div>
            </CardContent>
          </Card>}
      </div>
    </div>
  );
};

export default Dashboard;