import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine, ResponsiveContainer } from 'recharts';

export default function ResultsPage() {
  const { baselineId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);

  useEffect(() => {
    if (baselineId) {
      loadResults();
    }
  }, [baselineId]);

  const loadResults = async () => {
    try {
      // Get baseline data
      const { data: baseline, error: baselineError } = await supabase
        .from('product_baselines')
        .select('*')
        .eq('id', baselineId)
        .single();

      if (baselineError) throw baselineError;

      // Get pricing results
      const { data: results, error: resultsError } = await supabase
        .from('pricing_results')
        .select('*')
        .eq('baseline_id', baselineId)
        .single();

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
  const priceChange = ((results.suggested_price - baseline.current_price) / baseline.current_price) * 100;
  const isPriceIncrease = priceChange > 0;

  return (
    <div className="min-h-screen bg-gradient-hero p-4 md:p-8 animate-fade-in">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 animate-slide-up">
          <div className="flex items-center gap-3 mb-4">
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
              <Button onClick={handleRefreshCompetitors} disabled={isRefreshing} variant="outline" size="sm" className="gap-2">
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh Data
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">Current Price:</span>
                <span className="text-xl font-bold text-foreground">
                  {baseline.currency} {baseline.current_price.toFixed(2)}
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">Optimal Price:</span>
                <span className="text-xl font-bold text-primary">
                  {baseline.currency} {results.optimal_price.toFixed(2)} ⭐
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">Suggested Price:</span>
                <span className="text-xl font-bold text-foreground">
                  {baseline.currency} {results.suggested_price.toFixed(2)}
                </span>
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
                  {baseline.currency} {((baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity).toFixed(2)}
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-3 border-b">
                <span className="text-sm font-medium text-muted-foreground">Expected Monthly Profit:</span>
                <span className="text-base font-semibold text-success">
                  {baseline.currency} {results.expected_monthly_profit?.toFixed(2) || '0.00'}
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-muted-foreground">Profit Increase:</span>
                <span className="text-lg font-bold text-success">
                  +{baseline.currency} {results.profit_increase_amount?.toFixed(2) || '0.00'} 
                  <span className="text-sm ml-1">
                    (+{results.profit_increase_percent?.toFixed(1) || '0.0'}%)
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Warning if present */}
          {results.has_warning && (
            <Alert className="bg-warning/10 border-warning">
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
          <Card className="p-6 md:p-8 mb-6 shadow-elegant hover:shadow-glow transition-all animate-scale-in">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-foreground">
              <div className="p-2 bg-accent rounded-lg shadow-md">
                <span className="text-lg">🛒</span>
              </div>
              Competitive Intelligence
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
                        <span className="text-xl font-bold text-success">{comp.currency} {comp.lowest_price?.toFixed(2)}</span>
                      </div>
                      <div className="p-3 bg-white/50 rounded-lg border border-primary/20">
                        <span className="text-xs font-medium text-muted-foreground block mb-0.5">Average</span>
                        <span className="text-xl font-bold text-primary">{comp.currency} {comp.average_price?.toFixed(2)}</span>
                      </div>
                      <div className="p-3 bg-white/50 rounded-lg border border-destructive/20">
                        <span className="text-xs font-medium text-muted-foreground block mb-0.5">Highest</span>
                        <span className="text-xl font-bold text-destructive">{comp.currency} {comp.highest_price?.toFixed(2)}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
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
                    <span className="text-xl font-bold text-foreground">{baseline.currency} {results.market_average.toFixed(2)}</span>
                  </div>
                </div>
                <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">Market Range</span>
                    <span className="text-base font-bold text-foreground">
                      {baseline.currency} {results.market_lowest.toFixed(2)} - {results.market_highest.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-primary/10 rounded-lg border-2 border-primary shadow-md">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold text-primary">Your Price</span>
                    <span className="text-xl font-bold text-primary">
                      {baseline.currency} {results.suggested_price.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="p-4 bg-gradient-card rounded-lg border border-border hover:border-primary/30 transition-all">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-muted-foreground">vs Market</span>
                    <span className={`text-xl font-bold ${results.position_vs_market < 0 ? 'text-success' : 'text-destructive'}`}>
                      {results.position_vs_market > 0 ? '+' : ''}{results.position_vs_market?.toFixed(1)}%
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
            variant="outline" 
            className="flex-1 sm:flex-none shadow-md hover:shadow-lg transition-all"
            onClick={handleRefreshCompetitors}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh Data'}
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
