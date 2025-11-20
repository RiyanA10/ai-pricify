import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { 
  CheckCircle2, 
  XCircle, 
  Package, 
  TrendingUp, 
  ExternalLink,
  AlertCircle,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Button } from '@/components/ui/button';

interface CompetitorProduct {
  product_name: string;
  price: number;
  marketplace: string;
  similarity_score: number;
  price_ratio: number;
  rank: number;
  product_url: string | null;
  filterReason?: string;
}

interface ProductDetail {
  baseline: {
    id: string;
    product_name: string;
    current_price: number;
    currency: string;
    category: string;
    created_at: string;
    merchant_email: string;
  };
  totalCompetitors: number;
  usedCompetitors: CompetitorProduct[];
  filteredCompetitors: CompetitorProduct[];
  marketData: {
    market_average: number | null;
    market_lowest: number | null;
    market_highest: number | null;
    suggested_price: number;
  } | null;
}

const AdminProductDetails = () => {
  const [products, setProducts] = useState<ProductDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchProductDetails = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        const { data, error } = await supabase.functions.invoke('admin', {
          body: { action: 'product-competitor-details' },
        });

        if (error) throw error;
        setProducts(data.productDetails || []);
      } catch (error) {
        console.error('Error fetching product details:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchProductDetails();
  }, []);

  const toggleProduct = (productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Loading product details...</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Product-Level Competitor Analysis</CardTitle>
          <CardDescription>
            Detailed breakdown of competitor products found, used, and filtered for each upload
          </CardDescription>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No product data available</p>
          ) : (
            <div className="space-y-4">
              {products.map((product) => {
                const isExpanded = expandedProducts.has(product.baseline.id);
                
                return (
                  <Collapsible
                    key={product.baseline.id}
                    open={isExpanded}
                    onOpenChange={() => toggleProduct(product.baseline.id)}
                  >
                    <div className="border rounded-lg">
                      <CollapsibleTrigger asChild>
                        <Button 
                          variant="ghost" 
                          className="w-full justify-between p-4 hover:bg-muted/50"
                        >
                          <div className="flex items-start gap-4 flex-1 text-left">
                            <Package className="h-5 w-5 mt-1 shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold">{product.baseline.product_name}</h3>
                                <Badge variant="outline" className="text-xs">
                                  {product.baseline.category}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                <span>{product.baseline.merchant_email}</span>
                                <span>•</span>
                                <span>
                                  {product.baseline.currency} {product.baseline.current_price.toFixed(2)}
                                </span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  {product.totalCompetitors} competitors found
                                  {product.totalCompetitors === 0 && (
                                    <AlertCircle className="h-3 w-3 text-red-500" />
                                  )}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Badge 
                                variant={product.usedCompetitors.length > 0 ? 'default' : 'destructive'}
                              >
                                {product.usedCompetitors.length} Used
                              </Badge>
                              {product.filteredCompetitors.length > 0 && (
                                <Badge variant="secondary">
                                  {product.filteredCompetitors.length} Filtered
                                </Badge>
                              )}
                            </div>
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="h-5 w-5 shrink-0 ml-2" />
                          ) : (
                            <ChevronRight className="h-5 w-5 shrink-0 ml-2" />
                          )}
                        </Button>
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <div className="border-t p-4 space-y-6">
                          {/* Market Data Summary */}
                          {product.marketData && (
                            <div className="bg-muted/30 rounded-lg p-4">
                              <h4 className="font-medium mb-3 flex items-center gap-2">
                                <TrendingUp className="h-4 w-4" />
                                Market Position
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <p className="text-xs text-muted-foreground mb-1">Current Price</p>
                                  <p className="text-lg font-bold">
                                    {product.baseline.currency} {product.baseline.current_price.toFixed(2)}
                                  </p>
                                </div>
                                {product.marketData.market_average && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1">Market Average</p>
                                    <p className="text-lg font-bold">
                                      {product.baseline.currency} {product.marketData.market_average.toFixed(2)}
                                    </p>
                                  </div>
                                )}
                                {product.marketData.market_lowest && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1">Market Lowest</p>
                                    <p className="text-lg font-bold text-green-600">
                                      {product.baseline.currency} {product.marketData.market_lowest.toFixed(2)}
                                    </p>
                                  </div>
                                )}
                                {product.marketData.market_highest && (
                                  <div>
                                    <p className="text-xs text-muted-foreground mb-1">Market Highest</p>
                                    <p className="text-lg font-bold text-red-600">
                                      {product.baseline.currency} {product.marketData.market_highest.toFixed(2)}
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Used Competitors */}
                          {product.usedCompetitors.length > 0 && (
                            <div>
                              <h4 className="font-medium mb-3 flex items-center gap-2">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                                Competitors Used in Calculations ({product.usedCompetitors.length})
                              </h4>
                              <div className="space-y-2">
                                {product.usedCompetitors.map((comp, idx) => (
                                  <div 
                                    key={idx}
                                    className="border rounded-lg p-3 bg-green-50/50 dark:bg-green-950/20"
                                  >
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                          <Badge variant="outline" className="text-xs">
                                            Rank #{comp.rank}
                                          </Badge>
                                          <span className="font-medium">{comp.product_name}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{comp.marketplace}</p>
                                      </div>
                                      {comp.product_url && (
                                        <a
                                          href={comp.product_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-500 hover:text-blue-600"
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                        </a>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                      <div>
                                        <p className="text-muted-foreground">Price</p>
                                        <p className="font-medium">
                                          {product.baseline.currency} {comp.price.toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Similarity</p>
                                        <p className="font-medium">
                                          {(comp.similarity_score * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Price Ratio</p>
                                        <p className="font-medium">{comp.price_ratio.toFixed(2)}x</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Filtered Competitors */}
                          {product.filteredCompetitors.length > 0 && (
                            <div>
                              <h4 className="font-medium mb-3 flex items-center gap-2">
                                <XCircle className="h-4 w-4 text-red-500" />
                                Competitors Filtered Out ({product.filteredCompetitors.length})
                              </h4>
                              <div className="space-y-2">
                                {product.filteredCompetitors.map((comp, idx) => (
                                  <div 
                                    key={idx}
                                    className="border rounded-lg p-3 bg-red-50/50 dark:bg-red-950/20"
                                  >
                                    <div className="flex items-start justify-between mb-2">
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                          <Badge variant="outline" className="text-xs">
                                            Rank #{comp.rank}
                                          </Badge>
                                          <span className="font-medium">{comp.product_name}</span>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{comp.marketplace}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                          <AlertCircle className="h-3 w-3 text-red-500" />
                                          <span className="text-xs text-red-600 dark:text-red-400">
                                            {comp.filterReason}
                                          </span>
                                        </div>
                                      </div>
                                      {comp.product_url && (
                                        <a
                                          href={comp.product_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-500 hover:text-blue-600"
                                        >
                                          <ExternalLink className="h-4 w-4" />
                                        </a>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-3 gap-4 text-sm">
                                      <div>
                                        <p className="text-muted-foreground">Price</p>
                                        <p className="font-medium">
                                          {product.baseline.currency} {comp.price.toFixed(2)}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Similarity</p>
                                        <p className="font-medium">
                                          {(comp.similarity_score * 100).toFixed(0)}%
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-muted-foreground">Price Ratio</p>
                                        <p className="font-medium">{comp.price_ratio.toFixed(2)}x</p>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* No Competitors Case */}
                          {product.totalCompetitors === 0 && (
                            <div className="text-center py-8">
                              <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
                              <h4 className="font-medium mb-2">No Competitors Found</h4>
                              <p className="text-sm text-muted-foreground">
                                No competitor products were found during scraping for this upload.
                              </p>
                            </div>
                          )}
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminProductDetails;
