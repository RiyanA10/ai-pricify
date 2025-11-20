import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, TrendingUp, Package, AlertTriangle, Target, Activity } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AdminProductDetails from './AdminProductDetails';

interface CompetitorStats {
  marketplace: string;
  totalFetches: number;
  successfulFetches: number;
  failedFetches: number;
  avgProductsFound: number;
}

interface AnalyticsData {
  uploadMetrics: {
    totalUploads: number;
    withCompetitors: number;
    withoutCompetitors: number;
    avgCompetitorsPerProduct: string;
  };
  distribution: {
    zero: number;
    one: number;
    twoToThree: number;
    fourPlus: number;
  };
  pricePosition: {
    muchBelow: number;
    competitive: number;
    atMarket: number;
    aboveMarket: number;
    muchAbove: number;
    noData: number;
  };
  scrapingHealth: {
    totalFetches: number;
    successfulFetches: number;
    failedFetches: number;
    successRate: string;
  };
  dataQuality: {
    avgSimilarity: string;
    totalCompetitors: number;
    productsWithWarnings: number;
  };
}

const AdminCompetitors = () => {
  const [stats, setStats] = useState<CompetitorStats[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        // Fetch marketplace stats
        const { data: prices, error: pricesError } = await supabase
          .from('competitor_prices')
          .select('marketplace, fetch_status, products_found');

        if (pricesError) throw pricesError;

        const marketplaceMap = new Map<string, CompetitorStats>();
        prices?.forEach(price => {
          if (!marketplaceMap.has(price.marketplace)) {
            marketplaceMap.set(price.marketplace, {
              marketplace: price.marketplace,
              totalFetches: 0,
              successfulFetches: 0,
              failedFetches: 0,
              avgProductsFound: 0,
            });
          }

          const stat = marketplaceMap.get(price.marketplace)!;
          stat.totalFetches++;
          
          if (price.fetch_status === 'success') {
            stat.successfulFetches++;
            stat.avgProductsFound += price.products_found || 0;
          } else if (price.fetch_status === 'failed') {
            stat.failedFetches++;
          }
        });

        const statsArray = Array.from(marketplaceMap.values()).map(stat => ({
          ...stat,
          avgProductsFound: stat.successfulFetches > 0 
            ? Math.round(stat.avgProductsFound / stat.successfulFetches)
            : 0,
        }));

        setStats(statsArray);

        // Fetch detailed analytics
        const { data: analyticsData, error: analyticsError } = await supabase.functions.invoke('admin', {
          body: { action: 'competitor-analytics' },
        });

        if (analyticsError) throw analyticsError;
        setAnalytics(analyticsData);

      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const calculateSuccessRate = (successful: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((successful / total) * 100);
  };

  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Loading analytics...</p>;
  }

  return (
    <Tabs defaultValue="analytics" className="space-y-6">
      <TabsList>
        <TabsTrigger value="analytics">Analytics Overview</TabsTrigger>
        <TabsTrigger value="product-details">Product Details</TabsTrigger>
      </TabsList>

      <TabsContent value="analytics" className="space-y-6">
        {/* Upload Success Metrics */}
        {analytics && (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Uploads</CardTitle>
                  <Package className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.uploadMetrics.totalUploads}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.uploadMetrics.avgCompetitorsPerProduct} competitors/product
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">With Competitors</CardTitle>
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{analytics.uploadMetrics.withCompetitors}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.uploadMetrics.totalUploads > 0
                      ? ((analytics.uploadMetrics.withCompetitors / analytics.uploadMetrics.totalUploads) * 100).toFixed(1)
                      : 0}% success rate
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">No Competitors</CardTitle>
                  <XCircle className="h-4 w-4 text-red-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">{analytics.uploadMetrics.withoutCompetitors}</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.uploadMetrics.totalUploads > 0
                      ? ((analytics.uploadMetrics.withoutCompetitors / analytics.uploadMetrics.totalUploads) * 100).toFixed(1)
                      : 0}% no data
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Scraping Health</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{analytics.scrapingHealth.successRate}%</div>
                  <p className="text-xs text-muted-foreground">
                    {analytics.scrapingHealth.successfulFetches}/{analytics.scrapingHealth.totalFetches} successful
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Competitor Distribution */}
            <Card>
              <CardHeader>
                <CardTitle>Competitor Fetch Efficiency</CardTitle>
                <CardDescription>Distribution of competitors found per product</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">0 Competitors</p>
                    <p className="text-2xl font-bold">{analytics.distribution.zero}</p>
                    <Badge variant="destructive" className="mt-2">No Data</Badge>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">1 Competitor</p>
                    <p className="text-2xl font-bold">{analytics.distribution.one}</p>
                    <Badge variant="secondary" className="mt-2">Low</Badge>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">2-3 Competitors</p>
                    <p className="text-2xl font-bold">{analytics.distribution.twoToThree}</p>
                    <Badge variant="default" className="mt-2">Good</Badge>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">4+ Competitors</p>
                    <p className="text-2xl font-bold">{analytics.distribution.fourPlus}</p>
                    <Badge variant="default" className="mt-2">Excellent</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Price Position Analysis */}
            <Card>
              <CardHeader>
                <CardTitle>Price Position Analysis</CardTitle>
                <CardDescription>User prices vs market comparison</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-green-500" />
                      <span className="font-medium">Much Below (-20%+)</span>
                    </div>
                    <Badge variant="outline">{analytics.pricePosition.muchBelow} products</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-blue-500" />
                      <span className="font-medium">Competitive (-5% to -20%)</span>
                    </div>
                    <Badge variant="outline">{analytics.pricePosition.competitive} products</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-yellow-500" />
                      <span className="font-medium">At Market (±5%)</span>
                    </div>
                    <Badge variant="outline">{analytics.pricePosition.atMarket} products</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-orange-500" />
                      <span className="font-medium">Above Market (+5% to +20%)</span>
                    </div>
                    <Badge variant="outline">{analytics.pricePosition.aboveMarket} products</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4 text-red-500" />
                      <span className="font-medium">Much Above (+20%+)</span>
                    </div>
                    <Badge variant="outline">{analytics.pricePosition.muchAbove} products</Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">No Market Data</span>
                    </div>
                    <Badge variant="outline">{analytics.pricePosition.noData} products</Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Data Quality */}
            <Card>
              <CardHeader>
                <CardTitle>Data Quality Metrics</CardTitle>
                <CardDescription>Competitor product matching and accuracy</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">Avg Similarity Score</p>
                    <p className="text-2xl font-bold">{analytics.dataQuality.avgSimilarity}</p>
                    <p className="text-xs text-muted-foreground mt-2">Competitor match quality</p>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">Total Competitors</p>
                    <p className="text-2xl font-bold">{analytics.dataQuality.totalCompetitors}</p>
                    <p className="text-xs text-muted-foreground mt-2">Products scraped</p>
                  </div>
                  <div className="border rounded-lg p-4">
                    <p className="text-sm text-muted-foreground mb-1">With Warnings</p>
                    <p className="text-2xl font-bold">{analytics.dataQuality.productsWithWarnings}</p>
                    <p className="text-xs text-muted-foreground mt-2">Products flagged</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Marketplace Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Marketplace Performance</CardTitle>
            <CardDescription>Success rates by marketplace</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No marketplace data available</p>
            ) : (
              <div className="space-y-4">
                {stats.map((stat) => {
                  const successRate = calculateSuccessRate(stat.successfulFetches, stat.totalFetches);
                  
                  return (
                    <div key={stat.marketplace} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-lg">{stat.marketplace}</h3>
                        <Badge variant={successRate >= 80 ? 'default' : successRate >= 50 ? 'secondary' : 'destructive'}>
                          {successRate}% Success Rate
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground mb-1">Total Fetches</p>
                          <p className="text-2xl font-bold">{stat.totalFetches}</p>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <p className="text-sm text-muted-foreground">Successful</p>
                          </div>
                          <p className="text-2xl font-bold text-green-600">{stat.successfulFetches}</p>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <XCircle className="h-4 w-4 text-red-500" />
                            <p className="text-sm text-muted-foreground">Failed</p>
                          </div>
                          <p className="text-2xl font-bold text-red-600">{stat.failedFetches}</p>
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <TrendingUp className="h-4 w-4 text-blue-500" />
                            <p className="text-sm text-muted-foreground">Avg Products</p>
                          </div>
                          <p className="text-2xl font-bold text-blue-600">{stat.avgProductsFound}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="product-details">
        <AdminProductDetails />
      </TabsContent>
    </Tabs>
  );
};

export default AdminCompetitors;
