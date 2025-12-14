import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, TrendingDown, Search, Filter, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatNumber, formatPrice } from '@/lib/utils';

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
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; productId: string | null; productName: string }>({
    open: false,
    productId: null,
    productName: '',
  });

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

      // Get all product baselines (exclude soft deleted)
      const { data: baselines, error: baselinesError } = await supabase
        .from('product_baselines')
        .select('*')
        .eq('merchant_id', user.id)
        .is('deleted_at', null)
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

  const handleDeleteClick = (e: React.MouseEvent, productId: string, productName: string) => {
    e.stopPropagation();
    setDeleteDialog({ open: true, productId, productName });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteDialog.productId) return;

    try {
      const { error } = await supabase
        .from('product_baselines')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', deleteDialog.productId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Product archived successfully',
      });

      loadProducts();
    } catch (error) {
      console.error('Failed to delete product:', error);
      toast({
        title: 'Error',
        description: 'Failed to archive product',
        variant: 'destructive',
      });
    }
  };

  // Use semantic badge variants from design system for consistent styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'optimized':
        return <Badge variant="success">✅ Optimized</Badge>;
      case 'action':
        return <Badge variant="warning">⚡ Action Needed</Badge>;
      case 'processing':
        return <Badge variant="muted">🔄 Processing</Badge>;
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
    <div className="min-h-screen bg-background p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="max-w-[1600px] mx-auto w-full">
        {/* Header */}
        <div className="mb-4 md:mb-6">
          <Button
            variant="outline"
            onClick={() => navigate('/')}
            className="mb-3 md:mb-4"
            size="sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>

          <div className="flex items-center justify-between flex-wrap gap-3 md:gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-1 md:mb-2">📦 My Products</h1>
              <p className="text-sm md:text-base text-muted-foreground">Manage and optimize your product pricing</p>
            </div>
            <Button onClick={() => navigate('/?view=upload')} className="gap-2" size="sm">
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Upload New Products</span>
              <span className="sm:hidden">Upload</span>
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <Card className="p-3 md:p-4 mb-4 md:mb-6">
          <div className="flex items-center gap-2 md:gap-4 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9 md:h-10"
                />
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Filter className="w-4 h-4" />
              <span className="hidden sm:inline">Filter</span>
            </Button>
          </div>
        </Card>

        {/* Products Grid - Desktop & Tablet */}
        <div className="hidden md:block">
          <Card className="overflow-hidden">
            <div className="bg-muted/50 px-4 lg:px-6 py-3 lg:py-4 font-semibold text-xs lg:text-sm grid grid-cols-12 gap-2 lg:gap-4">
              <div className="col-span-3 lg:col-span-3">Product Name</div>
              <div className="col-span-2 text-center">Current</div>
              <div className="col-span-2 text-center">Optimal</div>
              <div className="col-span-2 text-center">Potential</div>
              <div className="col-span-2 text-center">Status</div>
              <div className="col-span-1 text-center">Actions</div>
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
                    className="px-4 lg:px-6 py-3 lg:py-4 hover:bg-muted/30 cursor-pointer transition-colors grid grid-cols-12 gap-2 lg:gap-4 items-center"
                  >
                    <div className="col-span-3 min-w-0">
                      <p className="font-semibold text-foreground text-sm lg:text-base truncate">{product.product_name}</p>
                      <p className="text-xs lg:text-sm text-muted-foreground truncate">{product.category}</p>
                    </div>
                    <div className="col-span-2 text-center">
                      <p className="font-semibold text-xs lg:text-sm">{formatPrice(product.current_price, product.currency)}</p>
                    </div>
                    <div className="col-span-2 text-center">
                      {product.optimal_price ? (
                        <div>
                          <p className="font-semibold text-primary text-xs lg:text-sm">{formatPrice(product.optimal_price, product.currency)}</p>
                          <div className="flex items-center justify-center gap-1 text-[10px] lg:text-xs">
                            {isPriceIncrease ? (
                              <TrendingUp className="w-2.5 h-2.5 lg:w-3 lg:h-3 text-success" />
                            ) : (
                              <TrendingDown className="w-2.5 h-2.5 lg:w-3 lg:h-3 text-destructive" />
                            )}
                            <span className={isPriceIncrease ? 'text-success' : 'text-destructive'}>
                              {priceChange > 0 ? '+' : ''}{formatNumber(priceChange, 1)}%
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">Processing...</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center">
                      {product.profit_increase ? (
                        <p className="font-semibold text-success text-xs lg:text-sm">+{formatPrice(product.profit_increase, product.currency)}/mo</p>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </div>
                    <div className="col-span-2 text-center flex justify-center">
                      {getStatusBadge(product.status)}
                    </div>
                    <div className="col-span-1 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteClick(e, product.id, product.product_name)}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Products Grid - Mobile */}
        <div className="md:hidden space-y-3">
          {filteredProducts.map((product) => {
            const priceChange = product.optimal_price 
              ? ((product.optimal_price - product.current_price) / product.current_price) * 100 
              : 0;
            const isPriceIncrease = priceChange > 0;

            return (
              <Card
                key={product.id}
                onClick={() => navigate(`/results/${product.id}`)}
                className="p-3 sm:p-4 cursor-pointer hover:shadow-lg transition-all"
              >
                <div className="flex items-start justify-between mb-2 sm:mb-3 gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-sm sm:text-base mb-1 truncate">{product.product_name}</h3>
                    <p className="text-xs sm:text-sm text-muted-foreground truncate">{product.category}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {getStatusBadge(product.status)}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleDeleteClick(e, product.id, product.product_name)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs sm:text-sm text-muted-foreground">Current:</span>
                    <span className="font-semibold text-sm sm:text-base">{formatPrice(product.current_price, product.currency)}</span>
                  </div>
                  {product.optimal_price && (
                    <>
                      <div className="flex justify-between items-center">
                        <span className="text-xs sm:text-sm text-muted-foreground">Optimal:</span>
                        <div className="text-right">
                          <span className="font-semibold text-primary text-sm sm:text-base">{formatPrice(product.optimal_price, product.currency)}</span>
                          <span className={`ml-2 text-xs ${isPriceIncrease ? 'text-success' : 'text-destructive'}`}>
                            ({priceChange > 0 ? '+' : ''}{formatNumber(priceChange, 1)}%)
                          </span>
                        </div>
                      </div>
                      {product.profit_increase && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs sm:text-sm text-muted-foreground">Potential:</span>
                          <span className="font-semibold text-success text-sm sm:text-base">+{formatPrice(product.profit_increase, product.currency)}/month</span>
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
          <Card className="p-8 md:p-12 text-center">
            <p className="text-sm md:text-base text-muted-foreground mb-4">No products found</p>
            <Button onClick={() => navigate('/?view=upload')} size="sm">
              <span className="hidden sm:inline">Upload Your First Product</span>
              <span className="sm:hidden">Upload Product</span>
            </Button>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, productId: null, productName: '' })}
        onConfirm={handleDeleteConfirm}
        title="Archive Product"
        description={`Are you sure you want to archive "${deleteDialog.productName}"? This product will be preserved for AI analysis but removed from your active product list.`}
        confirmText="Archive"
        variant="destructive"
      />
    </div>
  );
}
