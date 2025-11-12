import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Search, Filter, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ProductWithResults {
  id: string;
  product_name: string;
  category: string;
  current_price: number;
  currency: string;
  optimal_price?: number;
  profit_increase?: number;
  status: 'optimized' | 'action' | 'processing';
}

export default function ProductListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductWithResults[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/auth');
        return;
      }

      // Get all product baselines
      const { data: baselines, error: baselinesError } = await supabase
        .from('product_baselines')
        .select('*')
        .eq('merchant_id', user.id)
        .order('created_at', { ascending: false });

      if (baselinesError) throw baselinesError;

      // Get pricing results for each baseline
      const productsWithResults = await Promise.all(
        (baselines || []).map(async (baseline) => {
          const { data: result } = await supabase
            .from('pricing_results')
            .select('optimal_price, profit_increase_amount')
            .eq('baseline_id', baseline.id)
            .single();

          const priceChange = result?.optimal_price 
            ? ((result.optimal_price - baseline.current_price) / baseline.current_price) * 100 
            : 0;

          return {
            id: baseline.id,
            product_name: baseline.product_name,
            category: baseline.category,
            current_price: baseline.current_price,
            currency: baseline.currency,
            optimal_price: result?.optimal_price,
            profit_increase: result?.profit_increase_amount,
            status: result?.optimal_price 
              ? (Math.abs(priceChange) > 3 ? 'action' : 'optimized')
              : 'processing'
          } as ProductWithResults;
        })
      );

      setProducts(productsWithResults);
    } catch (error) {
      console.error('Failed to load products:', error);
      toast({
        title: 'Error',
        description: 'Failed to load products',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p => 
    p.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'optimized':
        return <Badge className="bg-success/10 text-success border-success/20">✅ Optimized</Badge>;
      case 'action':
        return <Badge className="bg-warning/10 text-warning border-warning/20">⚡ Action Needed</Badge>;
      case 'processing':
        return <Badge className="bg-muted/10 text-muted-foreground border-muted/20">🔄 Processing</Badge>;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-lg">Loading products...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Button
            variant="outline"
            onClick={() => navigate('/')}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>

          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">📦 My Products</h1>
              <p className="text-muted-foreground">Manage and optimize your product pricing</p>
            </div>
            <Button onClick={() => navigate('/?view=upload')} className="gap-2">
              <Download className="w-4 h-4" />
              Upload New Products
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <Card className="p-4 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" />
              Filter
            </Button>
          </div>
        </Card>

        {/* Products Grid - Desktop */}
        <div className="hidden md:block">
          <Card className="overflow-hidden">
            <div className="bg-muted/50 px-6 py-4 font-semibold text-sm grid grid-cols-12 gap-4">
              <div className="col-span-4">Product Name</div>
              <div className="col-span-2 text-center">Current Price</div>
              <div className="col-span-2 text-center">Optimal Price</div>
              <div className="col-span-2 text-center">Potential</div>
              <div className="col-span-2 text-center">Status</div>
            </div>

            <div className="divide-y">
              {filteredProducts.map((product) => {
                const priceChange = product.optimal_price 
                  ? ((product.optimal_price - product.current_price) / product.current_price) * 100 
                  : 0;
                const isPriceIncrease = priceChange > 0;

                return (
                  <div
                    key={product.id}
                    onClick={() => navigate(`/results/${product.id}`)}
                    className="px-6 py-4 hover:bg-muted/30 cursor-pointer transition-colors grid grid-cols-12 gap-4 items-center"
                  >
                    <div className="col-span-4">
                      <p className="font-semibold text-foreground">{product.product_name}</p>
                      <p className="text-sm text-muted-foreground">{product.category}</p>
                    </div>
                    <div className="col-span-2 text-center">
                      <p className="font-semibold">{product.currency} {product.current_price.toFixed(2)}</p>
                    </div>
                    <div className="col-span-2 text-center">
                      {product.optimal_price ? (
                        <div>
                          <p className="font-semibold text-primary">{product.currency} {product.optimal_price.toFixed(2)}</p>
                          <div className="flex items-center justify-center gap-1 text-xs">
                            {isPriceIncrease ? (
                              <TrendingUp className="w-3 h-3 text-success" />
                            ) : (
                              <TrendingDown className="w-3 h-3 text-destructive" />
                            )}
                            <span className={isPriceIncrease ? 'text-success' : 'text-destructive'}>
                              {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Processing...</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      {product.profit_increase ? (
                        <p className="font-semibold text-success">+{product.currency} {product.profit_increase.toFixed(0)}/mo</p>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      {getStatusBadge(product.status)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Products Grid - Mobile */}
        <div className="md:hidden space-y-4">
          {filteredProducts.map((product) => {
            const priceChange = product.optimal_price 
              ? ((product.optimal_price - product.current_price) / product.current_price) * 100 
              : 0;
            const isPriceIncrease = priceChange > 0;

            return (
              <Card
                key={product.id}
                onClick={() => navigate(`/results/${product.id}`)}
                className="p-4 cursor-pointer hover:shadow-lg transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground mb-1">{product.product_name}</h3>
                    <p className="text-sm text-muted-foreground">{product.category}</p>
                  </div>
                  {getStatusBadge(product.status)}
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Current:</span>
                    <span className="font-semibold">{product.currency} {product.current_price.toFixed(2)}</span>
                  </div>
                  {product.optimal_price && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Optimal:</span>
                        <div className="text-right">
                          <span className="font-semibold text-primary">{product.currency} {product.optimal_price.toFixed(2)}</span>
                          <span className={`ml-2 text-sm ${isPriceIncrease ? 'text-success' : 'text-destructive'}`}>
                            ({priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                      {product.profit_increase && (
                        <div className="flex justify-between">
                          <span className="text-sm text-muted-foreground">Potential:</span>
                          <span className="font-semibold text-success">+{product.currency} {product.profit_increase.toFixed(0)}/month</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {filteredProducts.length === 0 && (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground mb-4">No products found</p>
            <Button onClick={() => navigate('/?view=upload')}>Upload Your First Product</Button>
          </Card>
        )}
      </div>
    </div>
  );
}
