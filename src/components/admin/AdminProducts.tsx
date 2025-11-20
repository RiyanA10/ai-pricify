import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, RefreshCw, Trash2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useNavigate } from 'react-router-dom';

interface Product {
  id: string;
  product_name: string;
  current_price: number;
  currency: string;
  category: string;
  created_at: string;
  merchant_id: string;
  merchant_email: string;
}

const AdminProducts = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const fetchProducts = async () => {
    try {
      // Use admin edge function to get all products with user emails
      const { data, error } = await supabase.functions.invoke('admin', {
        body: { action: 'list-all-products' }
      });

      if (error) throw error;

      setProducts(data.products || []);
      setFilteredProducts(data.products || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      toast({
        title: "Error",
        description: "Failed to fetch products",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    const filtered = products.filter(product => 
      product.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.merchant_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.category.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredProducts(filtered);
  }, [searchQuery, products]);

  const handleForceRefresh = async (baselineId: string) => {
    setRefreshingId(baselineId);
    try {
      const { error } = await supabase.functions.invoke('refresh-competitors', {
        body: { baselineId }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Competitor refresh started",
      });
    } catch (error) {
      console.error('Error refreshing competitors:', error);
      toast({
        title: "Error",
        description: "Failed to refresh competitors",
        variant: "destructive",
      });
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;

    try {
      const { error } = await supabase
        .from('product_baselines')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', productToDelete);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Product deleted successfully",
      });

      fetchProducts();
    } catch (error) {
      console.error('Error deleting product:', error);
      toast({
        title: "Error",
        description: "Failed to delete product",
        variant: "destructive",
      });
    } finally {
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>All Products</CardTitle>
          <CardDescription>View and manage all products across all users</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Search */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by product name, user, or category..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Products Table */}
          <div className="space-y-4">
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Loading products...</p>
            ) : filteredProducts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No products found</p>
            ) : (
              filteredProducts.map((product) => (
                <div key={product.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold mb-1">{product.product_name}</h3>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span>User: {product.merchant_email}</span>
                        <span>Price: {product.current_price} {product.currency}</span>
                        <span>Category: {product.category}</span>
                        <span>Created: {new Date(product.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/results/${product.id}`)}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleForceRefresh(product.id)}
                        disabled={refreshingId === product.id}
                      >
                        <RefreshCw className={`h-4 w-4 ${refreshingId === product.id ? 'animate-spin' : ''}`} />
                      </Button>
                      
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setProductToDelete(product.id);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
          setProductToDelete(null);
        }}
        onConfirm={handleDeleteProduct}
        title="Delete Product"
        description="Are you sure you want to delete this product? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="destructive"
      />
    </>
  );
};

export default AdminProducts;
