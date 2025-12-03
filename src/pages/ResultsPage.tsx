import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, Download, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';
import { formatNumber, formatPrice } from '@/lib/utils';

export default function ResultsPage() {
  const { baselineId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const [allBaselines, setAllBaselines] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);

  useEffect(() => {
    if (baselineId) {
      loadAllBaselines();
      loadResults();
    }
  }, [baselineId]);

  const loadAllBaselines = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: baselines, error } = await supabase
        .from('product_baselines')
        .select('id, product_name')
        .eq('merchant_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (baselines) {
        setAllBaselines(baselines);
        const index = baselines.findIndex(b => b.id === baselineId);
        setCurrentIndex(index >= 0 ? index : 0);
      }
    } catch (error) {
      console.error('Failed to load baselines:', error);
    }
  };

  const navigateToProduct = (direction: 'prev' | 'next') => {
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < allBaselines.length) {
      navigate(`/results/${allBaselines[newIndex].id}`);
    }
  };

  const loadResults = async () => {
    try {
      // Get baseline data
      const { data: baseline, error: baselineError } = await supabase
        .from('product_baselines')
        .select('*')
        .eq('id', baselineId)
        .single();

      if (baselineError) throw baselineError;

      // Get pricing results (most recent)
      const { data: results, error: resultsError } = await supabase
        .from('pricing_results')
        .select('*')
        .eq('baseline_id', baselineId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (resultsError) throw resultsError;

      // Get competitor data
      const { data: competitors, error: compError } = await supabase
        .from('competitor_prices')
        .select('*')
        .eq('baseline_id', baselineId);

      if (compError) throw compError;

      setData({ baseline, results, competitors });
    } catch (error) {
      console.error('Failed to load results:', error);
      toast({
        title: 'Error',
        description: 'Failed to load pricing analysis',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshCompetitors = async () => {
    if (!baselineId) return;
    
    setIsRefreshing(true);
    
    try {
      const { data: functionData, error: functionError } = await supabase.functions.invoke('refresh-competitors', {
        body: { baseline_id: baselineId }
      });

      if (functionError) throw functionError;

      if (functionData.success) {
        setLastRefreshed(functionData.refreshed_at);
        
        toast({
          title: 'Success',
          description: 'Competitor prices refreshed successfully!',
        });
        
        // Reload page data
        await loadResults();
      } else {
        throw new Error('Failed to refresh competitor prices');
      }
    } catch (error) {
      console.error('Error refreshing data:', error);
      toast({
        title: 'Error',
        description: 'Failed to refresh competitor data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const exportToCSV = () => {
    if (!data) return;
    const { baseline, results} = data;

    const csvContent = `AI TRUEST Pricing Analysis Report
Generated: ${new Date().toLocaleString()}

PRODUCT INFORMATION
Product Name,${baseline.product_name}
Category,${baseline.category}
Currency,${baseline.currency}

PRICING RECOMMENDATION
Current Price,${baseline.current_price}
Optimal Price,${results.optimal_price}
Suggested Price,${results.suggested_price}
Price Change,${(((results.suggested_price - baseline.current_price) / baseline.current_price) * 100).toFixed(2)}%

PROFIT ANALYSIS
Current Monthly Profit,${(baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity}
Expected Monthly Profit,${results.expected_monthly_profit || 0}
Profit Increase,${results.profit_increase_amount || 0}
Profit Increase %,${results.profit_increase_percent || 0}%

ELASTICITY CALCULATION
Base Elasticity,${results.base_elasticity}
SAMA Inflation Rate,${(results.inflation_rate * 100).toFixed(2)}%
Inflation Adjustment,${results.inflation_adjustment}
Competitor Factor,${results.competitor_factor}
Calibrated Elasticity,${results.calibrated_elasticity}

MARKET POSITIONING
Market Average,${results.market_average || 'N/A'}
Market Lowest,${results.market_lowest || 'N/A'}
Market Highest,${results.market_highest || 'N/A'}
Position vs Market,${results.position_vs_market ? results.position_vs_market.toFixed(2) + '%' : 'N/A'}
`;

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AI-TRUEST-${baseline.product_name.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Success',
      description: 'Report exported successfully',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <p className="text-lg">Loading results...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Card className="p-8 text-center">
          <p className="text-lg mb-4">No results found</p>
          <Button onClick={() => navigate('/')}>Return to Upload</Button>
        </Card>
      </div>
    );
  }

  const { baseline, results, competitors } = data;
  
  // Handle case when pricing results haven't been generated yet
  if (!results) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <p className="text-lg mb-2 font-semibold">Pricing Analysis Pending</p>
          <p className="text-muted-foreground mb-4">
            The pricing analysis for "{baseline?.product_name}" hasn't been generated yet.
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => navigate('/products')} variant="outline">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Products
            </Button>
            <Button onClick={() => navigate(`/processing/${baselineId}`)}>
              Go to Processing
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const priceChange = ((results.suggested_price - baseline.current_price) / baseline.current_price) * 100;
  const isPriceIncrease = priceChange > 0;
  
  // Calculate profit changes
  const currentMonthlyProfit = (baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity;
  const profitChange = results.profit_increase_amount;
  const isProfitIncrease = profitChange > 0;

  return (
    <div className="min-h-screen bg-gradient-hero p-4 md:p-8 animate-fade-in">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 animate-slide-up">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                onClick={() => navigate('/products')}
                className="hover:shadow-lg transition-all"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Products
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('/')}
              >
                Dashboard
              </Button>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                onClick={() => navigateToProduct('prev')}
                disabled={currentIndex === 0}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <span className="text-sm text-muted-foreground px-3 font-medium">
                {currentIndex + 1} / {allBaselines.length}
              </span>
              <Button
                onClick={() => navigateToProduct('next')}
                disabled={currentIndex === allBaselines.length - 1}
                variant="outline"
                size="sm"
                className="gap-1"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
          
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-3 text-foreground">
                📊 Price Analysis Detail
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xl font-bold text-foreground">{baseline.product_name}</p>
                <Badge variant="secondary" className="px-3 py-1">{baseline.category}</Badge>
                <Badge variant="outline" className="px-3 py-1">{baseline.currency}</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Main Results Card */}
        <Card className="p-6 md:p-8 mb-6 shadow-lg border-2 border-primary/20 animate-scale-in">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-foreground">
              <div className="p-2 bg-primary rounded-lg shadow-md">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              💰 Pricing Overview
            </h2>
            <div className="flex gap-2">
              <Button onClick={exportToCSV} variant="outline" size="sm" className="gap-2">
                <Download className="w-4 h-4" />
                Download Report
              </Button>
              <Button 
                onClick={handleRefreshCompetitors} 
                disabled={isRefreshing} 
                variant="ghost" 
                size="sm" 
                className="gap-2 text-muted-foreground"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Update Now
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">Current Price:</span>
                <div className="text-xl font-bold text-foreground">
                  {baseline.current_price.toFixed(2)} <span className="text-base">{baseline.currency}</span>
                </div>
              </div>
              
              <div className="flex justify-between items-center pb-4 border-b-2 border-primary">
                <div className="flex items-center gap-2">
                  <span className="text-xl">⭐</span>
                  <span className="text-sm font-medium text-muted-foreground">
                    Suggested Price
                    <span className="ml-1 text-xs">(Recommended)</span>
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-primary">
                    {results.suggested_price.toFixed(2)} <span className="text-lg">{baseline.currency}</span>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">
                  Theoretical Optimal:
                  <span className="ml-1 text-xs">(Max profit, no market constraints)</span>
                </span>
                <div className="text-lg font-semibold text-muted-foreground">
                  {results.optimal_price.toFixed(2)} <span className="text-sm">{baseline.currency}</span>
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">Price Change:</span>
                <div className="flex items-center gap-2">
                  {isPriceIncrease ? (
                    <TrendingUp className="w-4 h-4 text-success" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-destructive" />
                  )}
                  <span className={`text-lg font-bold ${isPriceIncrease ? 'text-success' : 'text-destructive'}`}>
                    {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">Current Monthly Profit:</span>
                <span className="text-base font-semibold text-foreground">
                  {formatPrice(currentMonthlyProfit, baseline.currency)}
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">
                  {isProfitIncrease ? 'Expected Monthly Profit (After):' : 'Expected Monthly Profit (If Applied):'}
                </span>
                <span className={`text-base font-semibold ${isProfitIncrease ? 'text-success' : 'text-destructive'}`}>
                  {formatPrice(results.expected_monthly_profit, baseline.currency)}
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">
                  {isProfitIncrease ? 'Profit Increase:' : 'Profit Change:'}
                </span>
                <div className="flex items-center gap-2">
                  {isProfitIncrease ? (
                    <TrendingUp className="w-4 h-4 text-success" />
                  ) : (
                    <TrendingDown className="w-4 h-4 text-destructive" />
                  )}
                  <span className={`text-lg font-bold ${isProfitIncrease ? 'text-success' : 'text-destructive'}`}>
                    {isProfitIncrease ? '+' : ''}{formatPrice(profitChange, baseline.currency)} 
                    <span className="text-sm ml-1">
                      ({isProfitIncrease ? '+' : ''}{formatNumber(results.profit_increase_percent, 1)}%)
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Explanation Card */}
          <Card className="bg-muted/30 border-primary/20 mt-6">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-foreground">Understanding the Prices:</p>
                  <ul className="space-y-1.5 text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <span className="text-primary font-bold mt-0.5">⭐</span>
                      <span><strong>Suggested Price:</strong> Our recommended price that balances profit maximization with market competitiveness. This is the price you should use.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-muted-foreground mt-0.5">•</span>
                      <span><strong>Theoretical Optimal:</strong> Pure profit-maximizing price from elasticity formula, without considering competitor prices or market reality.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-muted-foreground mt-0.5">•</span>
                      <span><strong>Current Price:</strong> Your existing price for comparison purposes.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Warning if profit decreases AND price actually changes */}
          {!isProfitIncrease && priceChange !== 0 && (
            <Alert variant="destructive" className="mt-6">
              <AlertDescription>
                <strong>⚠️ Warning:</strong> The suggested price would <strong>reduce your monthly profit by {formatPrice(Math.abs(profitChange), baseline.currency)} ({Math.abs(results.profit_increase_percent).toFixed(1)}%)</strong>.
                <br /><br />
                <strong>Reason:</strong> Market prices are significantly lower than your current price. Lowering to match the market would hurt your profitability.
                <br /><br />
                <strong>Recommendation:</strong> Consider keeping your current price to maintain profit margins, or evaluate if your product offers unique value that justifies the premium pricing.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Price Maintained Warning - when suggested = current */}
          {results.has_warning && results.suggested_price === baseline.current_price && (
            <Alert className="bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 mt-6">
              <AlertDescription className="text-amber-800 dark:text-amber-200">
                <strong>💡 Price Maintained:</strong> Market prices (avg: {formatPrice(results.market_average || 0, baseline.currency)}) are below your current price. We're keeping your price at {formatPrice(baseline.current_price, baseline.currency)} to protect your profit margins.
                <br /><br />
                <strong>If you matched market:</strong> Lowering to market average would reduce profit by approximately {results.market_average ? ((baseline.current_price - results.market_average) / baseline.current_price * 100).toFixed(1) : '0'}%.
              </AlertDescription>
            </Alert>
          )}
          
          {/* Other warnings (not price maintained) */}
          {results.has_warning && results.suggested_price !== baseline.current_price && (
            <Alert className="bg-warning/10 border-warning mt-6">
              <AlertDescription className="text-warning-foreground">
                <strong>⚠️ Note:</strong> {results.warning_message}
              </AlertDescription>
            </Alert>
          )}
        </Card>

        {/* Elasticity Details */}
        <Card className="p-6 md:p-8 mb-6 shadow-elegant hover:shadow-glow transition-all animate-scale-in">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-foreground">
            <div className="p-2 bg-secondary rounded-lg shadow-md">
              <span className="text-lg">📊</span>
            </div>
            Elasticity Calculation
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
              <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Base Elasticity</p>
              <p className="text-2xl font-bold text-foreground">{results.base_elasticity.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground mt-1">({baseline.category})</p>
            </div>
            
            <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
              <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                {baseline.currency === 'SAR' ? 'SAMA' : 'US Federal'} Inflation
              </p>
              <p className="text-2xl font-bold text-warning">{(results.inflation_rate * 100).toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-1">
                {baseline.currency === 'SAR' ? '🇸🇦 Saudi Arabia' : '🇺🇸 United States'}
              </p>
            </div>
            
            <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
              <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Inflation Adjustment</p>
              <p className="text-2xl font-bold text-foreground">×{results.inflation_adjustment.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground mt-1">Price modifier</p>
            </div>
            
            <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
              <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Competitor Factor</p>
              <p className="text-2xl font-bold text-accent">×{results.competitor_factor.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {results.competitor_factor > 1 ? '📈 Below market' : results.competitor_factor < 1 ? '📉 Above market' : '➡️ At market'}
              </p>
            </div>
            
            <div className="p-4 bg-primary/10 rounded-lg border-2 border-primary shadow-md md:col-span-2 hover:shadow-lg transition-all">
              <p className="text-xs font-bold text-primary mb-1 uppercase tracking-wide">Calibrated Elasticity</p>
              <p className="text-3xl font-bold text-primary mb-1">{results.calibrated_elasticity.toFixed(3)}</p>
              <p className="text-sm font-semibold text-primary">
                {Math.abs(results.calibrated_elasticity) > 1 ? '🎯 Elastic demand' : '🎯 Inelastic demand'}
              </p>
            </div>
          </div>

          <div className="mt-6 p-4 bg-gradient-card rounded-lg border border-primary/20">
            <div className="flex gap-2">
              <span className="text-lg">💡</span>
              <div>
                <p className="font-bold text-sm text-primary mb-1">Interpretation</p>
                <p className="text-sm text-foreground leading-relaxed">
                  {Math.abs(results.calibrated_elasticity) > 1 
                    ? 'Customers are price-sensitive. Price changes will significantly affect sales volume.'
                    : 'Customers are less price-sensitive. You have more pricing flexibility.'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Competitor Intelligence */}
        {competitors && competitors.length > 0 && (
          <>
            {/* Market Summary */}
            <Card className="p-6 md:p-8 mb-6 shadow-elegant hover:shadow-glow transition-all animate-scale-in">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-foreground">
                <div className="p-2 bg-primary rounded-lg shadow-md">
                  <span className="text-lg">📊</span>
                </div>
                Market Summary - All Competitors
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="p-6 bg-gradient-to-br from-success/10 to-success/5 rounded-xl border-2 border-success/30 hover:border-success/50 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">📉</span>
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Lowest Price</span>
                  </div>
                  <p className="text-4xl font-bold text-success mb-1">
                    {formatPrice(Math.min(...competitors.filter((c: any) => c.fetch_status === 'success' && c.lowest_price).map((c: any) => c.lowest_price)), baseline.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">Across all marketplaces</p>
                </div>
                
                <div className="p-6 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl border-2 border-primary/30 hover:border-primary/50 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">📊</span>
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Average Price</span>
                  </div>
                  <p className="text-4xl font-bold text-primary mb-1">
                    {formatPrice(competitors.filter((c: any) => c.fetch_status === 'success' && c.average_price).reduce((sum: number, c: any) => sum + c.average_price, 0) / competitors.filter((c: any) => c.fetch_status === 'success' && c.average_price).length, baseline.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">Weighted average</p>
                </div>
                
                <div className="p-6 bg-gradient-to-br from-destructive/10 to-destructive/5 rounded-xl border-2 border-destructive/30 hover:border-destructive/50 transition-all">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-2xl">📈</span>
                    <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Highest Price</span>
                  </div>
                  <p className="text-4xl font-bold text-destructive mb-1">
                    {formatPrice(Math.max(...competitors.filter((c: any) => c.fetch_status === 'success' && c.highest_price).map((c: any) => c.highest_price)), baseline.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">Across all marketplaces</p>
                </div>
              </div>
            </Card>

            {/* Detailed Competitor Breakdown */}
            <Card className="p-6 md:p-8 mb-6 shadow-elegant hover:shadow-glow transition-all animate-scale-in">
              <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-foreground">
                <div className="p-2 bg-accent rounded-lg shadow-md">
                  <span className="text-lg">🛒</span>
                </div>
                By Marketplace
              </h2>
              
              <div className="space-y-4">
                {competitors.map((comp: any) => (
                <div key={comp.id} className="p-5 border-2 rounded-lg bg-gradient-card hover:border-primary/30 transition-all">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-lg uppercase text-foreground">{comp.marketplace}</h3>
                      {comp.fetch_status === 'success' ? (
                        <Badge variant="default" className="px-2 py-0.5 text-xs">✓ {comp.products_found} products</Badge>
                      ) : comp.fetch_status === 'no_data' ? (
                        <Badge variant="secondary" className="px-2 py-0.5 text-xs">No data</Badge>
                      ) : (
                        <Badge variant="destructive" className="px-2 py-0.5 text-xs">Failed</Badge>
                      )}
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      🕒 {new Date(comp.last_updated).toLocaleTimeString()}
                    </span>
                  </div>
                  
                    {comp.fetch_status === 'success' && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div className="p-3 bg-white/50 rounded-lg border border-success/20">
                          <span className="text-xs font-medium text-muted-foreground block mb-0.5">Lowest</span>
                          <span className="text-xl font-bold text-success">{formatPrice(comp.lowest_price, comp.currency)}</span>
                        </div>
                        <div className="p-3 bg-white/50 rounded-lg border border-primary/20">
                          <span className="text-xs font-medium text-muted-foreground block mb-0.5">Average</span>
                          <span className="text-xl font-bold text-primary">{formatPrice(comp.average_price, comp.currency)}</span>
                        </div>
                        <div className="p-3 bg-white/50 rounded-lg border border-destructive/20">
                          <span className="text-xs font-medium text-muted-foreground block mb-0.5">Highest</span>
                          <span className="text-xl font-bold text-destructive">{formatPrice(comp.highest_price, comp.currency)}</span>
                        </div>
                      </div>
                    )}
                </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* Market Positioning */}
        {results.market_average && (
          <Card className="p-6 md:p-8 mb-6 shadow-elegant hover:shadow-glow transition-all animate-scale-in">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-foreground">
              <div className="p-2 bg-success rounded-lg shadow-md">
                <span className="text-lg">📍</span>
              </div>
              Market Positioning
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">Market Average</span>
                    <span className="text-xl font-bold text-foreground">{formatPrice(results.market_average, baseline.currency)}</span>
                  </div>
                </div>
                <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">Market Range</span>
                    <span className="text-base font-bold text-foreground">
                      {formatPrice(results.market_lowest, baseline.currency)} - {formatPrice(results.market_highest, baseline.currency)}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg border-2 border-primary shadow-md">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-primary">Your Price</span>
                    <span className="text-xl font-bold text-primary">
                      {formatPrice(results.suggested_price, baseline.currency)}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">vs Market</span>
                    <span className={`text-xl font-bold ${results.position_vs_market < 0 ? 'text-success' : 'text-destructive'}`}>
                      {results.position_vs_market > 0 ? '+' : ''}{formatNumber(results.position_vs_market, 1)}%
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="p-4 bg-gradient-card rounded-lg border border-success/30 shadow-md flex items-start gap-2">
                <span className="text-lg">✅</span>
                <div>
                  <p className="font-bold text-sm text-success mb-1">Position</p>
                  <p className="text-sm text-foreground leading-relaxed">
                    {results.position_vs_market < 0 ? 'Below market average - competitive advantage' : 'Above market average - premium positioning'}
                  </p>
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 mb-8 animate-slide-up">
          <Button size="lg" className="flex-1 sm:flex-none shadow-lg hover:shadow-glow transition-all">
            ✨ Apply Suggested Price
          </Button>
          <Button 
            size="lg" 
            variant="ghost" 
            className="flex-1 sm:flex-none text-muted-foreground"
            onClick={handleRefreshCompetitors}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Updating...' : 'Update Now'}
          </Button>
          <Button 
            size="lg" 
            variant="secondary" 
            className="flex-1 sm:flex-none shadow-md hover:shadow-lg transition-all"
            onClick={exportToCSV}
          >
            <Download className="w-4 h-4 mr-2" />
            Download Report
          </Button>
        </div>

        {/* Footer */}
        <footer className="text-center py-8 border-t border-border/50 mt-8">
          <p className="text-sm font-semibold text-foreground mb-2">
            © 2025 AI TRUEST™ Saudi Arabia. All Rights Reserved.
          </p>
          <div className="flex items-center justify-center gap-4 text-sm text-foreground/80">
            <span>📩 <a href="mailto:info@paybacksa.com" className="hover:text-primary hover:underline transition-colors font-medium">info@paybacksa.com</a></span>
            <span>•</span>
            <span>📍 Riyadh, Saudi Arabia</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
