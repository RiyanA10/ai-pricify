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
    <div className="min-h-screen bg-gradient-subtle p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="ghost"
            onClick={() => navigate('/')}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Upload New Product
          </Button>
          
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2 bg-gradient-primary bg-clip-text text-transparent">
                AI TRUEST™ Pricing Analysis
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-xl font-semibold">{baseline.product_name}</p>
                <Badge variant="secondary">{baseline.category}</Badge>
                <Badge variant="outline">{baseline.currency}</Badge>
              </div>
            </div>
          </div>
        </div>

        {/* Main Results Card */}
        <Card className="p-6 md:p-8 mb-6 shadow-elegant">
          <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Pricing Recommendation
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Current Price:</span>
                <span className="text-2xl font-bold">
                  {baseline.currency} {baseline.current_price.toFixed(2)}
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Optimal Price:</span>
                <span className="text-2xl font-bold text-primary">
                  {baseline.currency} {results.optimal_price.toFixed(2)} ⭐
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Suggested Price:</span>
                <span className="text-2xl font-bold">
                  {baseline.currency} {results.suggested_price.toFixed(2)}
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Price Change:</span>
                <div className="flex items-center gap-2">
                  {isPriceIncrease ? (
                    <TrendingUp className="w-5 h-5 text-success" />
                  ) : (
                    <TrendingDown className="w-5 h-5 text-destructive" />
                  )}
                  <span className={`text-xl font-bold ${isPriceIncrease ? 'text-success' : 'text-destructive'}`}>
                    {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Current Monthly Profit:</span>
                <span className="text-lg font-semibold">
                  {baseline.currency} {((baseline.current_price - baseline.cost_per_unit) * baseline.current_quantity).toFixed(2)}
                </span>
              </div>
              
              <div className="flex justify-between items-center pb-2 border-b">
                <span className="text-muted-foreground">Expected Monthly Profit:</span>
                <span className="text-lg font-semibold text-success">
                  {baseline.currency} {results.expected_monthly_profit?.toFixed(2) || '0.00'}
                </span>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Profit Increase:</span>
                <span className="text-xl font-bold text-success">
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
        <Card className="p-6 md:p-8 mb-6 shadow-card-hover">
          <h2 className="text-2xl font-bold mb-6">Elasticity Calculation</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Base Elasticity</p>
              <p className="text-xl font-bold">{results.base_elasticity.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground mt-1">({baseline.category})</p>
            </div>
            
            <div className="p-4 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">SAMA Inflation Rate</p>
              <p className="text-xl font-bold">{(results.inflation_rate * 100).toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-1">Current rate</p>
            </div>
            
            <div className="p-4 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Inflation Adjustment</p>
              <p className="text-xl font-bold">×{results.inflation_adjustment.toFixed(3)}</p>
            </div>
            
            <div className="p-4 bg-muted/30 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">Competitor Factor</p>
              <p className="text-xl font-bold">×{results.competitor_factor.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {results.competitor_factor > 1 ? 'Below market avg' : results.competitor_factor < 1 ? 'Above market avg' : 'At market avg'}
              </p>
            </div>
            
            <div className="p-4 bg-primary/10 rounded-lg border border-primary/20 md:col-span-2">
              <p className="text-sm text-muted-foreground mb-1">Calibrated Elasticity</p>
              <p className="text-2xl font-bold text-primary">{results.calibrated_elasticity.toFixed(3)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {Math.abs(results.calibrated_elasticity) > 1 ? 'Elastic demand' : 'Inelastic demand'}
              </p>
            </div>
          </div>

          <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/20">
            <p className="text-sm">
              <strong>💡 Interpretation:</strong>{' '}
              {Math.abs(results.calibrated_elasticity) > 1 
                ? 'Customers are price-sensitive. Price changes will significantly affect sales volume.'
                : 'Customers are less price-sensitive. You have more pricing flexibility.'}
            </p>
          </div>
        </Card>

        {/* Competitor Intelligence */}
        {competitors && competitors.length > 0 && (
          <Card className="p-6 md:p-8 mb-6 shadow-card-hover">
            <h2 className="text-2xl font-bold mb-6">Competitive Intelligence</h2>
            
            <div className="space-y-4">
              {competitors.map((comp: any) => (
                <div key={comp.id} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-lg uppercase">{comp.marketplace}</h3>
                      {comp.fetch_status === 'success' ? (
                        <Badge variant="default">✓ Found {comp.products_found} products</Badge>
                      ) : comp.fetch_status === 'no_data' ? (
                        <Badge variant="secondary">No data available</Badge>
                      ) : (
                        <Badge variant="destructive">Failed to fetch</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Updated {new Date(comp.last_updated).toLocaleTimeString()}
                    </span>
                  </div>
                  
                  {comp.fetch_status === 'success' && (
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-muted-foreground">Lowest: </span>
                        <span className="font-semibold">{comp.currency} {comp.lowest_price?.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Average: </span>
                        <span className="font-semibold">{comp.currency} {comp.average_price?.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Highest: </span>
                        <span className="font-semibold">{comp.currency} {comp.highest_price?.toFixed(2)}</span>
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
          <Card className="p-6 md:p-8 mb-6 shadow-card-hover">
            <h2 className="text-2xl font-bold mb-6">Market Positioning</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Market Average:</span>
                  <span className="font-semibold">{baseline.currency} {results.market_average.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Market Range:</span>
                  <span className="font-semibold">
                    {baseline.currency} {results.market_lowest.toFixed(2)} - {results.market_highest.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Your Suggested Price:</span>
                  <span className="font-semibold text-primary">
                    {baseline.currency} {results.suggested_price.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Position vs Market:</span>
                  <span className={`font-semibold ${results.position_vs_market < 0 ? 'text-success' : 'text-destructive'}`}>
                    {results.position_vs_market > 0 ? '+' : ''}{results.position_vs_market?.toFixed(1)}%
                  </span>
                </div>
              </div>
              
              <div className="p-4 bg-success/10 rounded-lg border border-success/20 flex items-center">
                <p className="text-sm">
                  ✅ Your price is {results.position_vs_market < 0 ? 'competitively positioned below' : 'positioned above'} market average,
                  {results.position_vs_market < 0 ? ' giving you a competitive advantage.' : ' targeting premium positioning.'}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4">
          <Button size="lg" className="flex-1 sm:flex-none">
            Apply Suggested Price
          </Button>
          <Button size="lg" variant="outline" className="flex-1 sm:flex-none">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh Competitor Data
          </Button>
          <Button size="lg" variant="outline" className="flex-1 sm:flex-none" onClick={exportToCSV}>
            <Download className="w-4 h-4 mr-2" />
            Export Report (CSV)
          </Button>
        </div>
      </div>
    </div>
  );
}
