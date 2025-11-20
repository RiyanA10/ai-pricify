import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, TrendingUp } from 'lucide-react';

interface CompetitorStats {
  marketplace: string;
  totalFetches: number;
  successfulFetches: number;
  failedFetches: number;
  avgProductsFound: number;
}

const AdminCompetitors = () => {
  const [stats, setStats] = useState<CompetitorStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCompetitorStats = async () => {
      try {
        const { data: prices, error } = await supabase
          .from('competitor_prices')
          .select('marketplace, fetch_status, products_found');

        if (error) throw error;

        // Group by marketplace
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

        // Calculate averages
        const statsArray = Array.from(marketplaceMap.values()).map(stat => ({
          ...stat,
          avgProductsFound: stat.successfulFetches > 0 
            ? Math.round(stat.avgProductsFound / stat.successfulFetches)
            : 0,
        }));

        setStats(statsArray);
      } catch (error) {
        console.error('Error fetching competitor stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchCompetitorStats();
  }, []);

  const calculateSuccessRate = (successful: number, total: number) => {
    if (total === 0) return 0;
    return Math.round((successful / total) * 100);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Competitor Scraping Statistics</CardTitle>
          <CardDescription>Success rates and performance by marketplace</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-center text-muted-foreground py-8">Loading statistics...</p>
          ) : stats.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No scraping data available</p>
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
    </div>
  );
};

export default AdminCompetitors;
