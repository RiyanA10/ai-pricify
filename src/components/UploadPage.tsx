import { useState } from 'react';
import { Upload, Download, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { parseExcelFile, generateExcelTemplate, type ValidationError, type ProductData } from '@/utils/excelParser';
import { CATEGORY_ELASTICITY } from '@/utils/categoryElasticity';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

export const UploadPage = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    const dataFile = files.find(f => {
      const fileName = f.name.toLowerCase();
      return fileName.endsWith('.xlsx') || 
             fileName.endsWith('.xls') || 
             fileName.endsWith('.csv');
    });
    
    if (dataFile) {
      await processFile(dataFile);
    } else {
      toast({
        title: 'Invalid file',
        description: 'Please upload an Excel file (.xlsx, .xls) or CSV file (.csv)',
        variant: 'destructive',
      });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setIsProcessing(true);
    setErrors([]);

    try {
      const { data: products, errors: validationErrors } = await parseExcelFile(file);
      
      if (validationErrors.length > 0) {
        setErrors(validationErrors);
        toast({
          title: 'Validation errors found',
          description: `Found ${validationErrors.length} error(s) in your Excel file`,
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      }

      if (products.length === 0) {
        toast({
          title: 'No data found',
          description: 'Your Excel file contains no valid products',
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      }

      // Use a temporary merchant ID (in production, this would be the authenticated user's ID)
      const merchantId = crypto.randomUUID();

      // Insert all products into database
      const productsWithElasticity = products.map(p => ({
        merchant_id: merchantId,
        product_name: p.product_name,
        category: p.category,
        current_price: p.current_price,
        current_quantity: p.current_quantity,
        cost_per_unit: p.cost_per_unit,
        currency: p.currency,
        base_elasticity: CATEGORY_ELASTICITY[p.category],
      }));

      const { data: insertedProducts, error: insertError } = await supabase
        .from('product_baselines')
        .insert(productsWithElasticity)
        .select();

      if (insertError) throw insertError;

      toast({
        title: 'Success!',
        description: `${products.length} product(s) uploaded successfully`,
      });

      // Navigate to processing page with first product ID
      if (insertedProducts && insertedProducts.length > 0) {
        navigate(`/processing/${insertedProducts[0].id}`);
      }

    } catch (error) {
      console.error('Error processing file:', error);
      toast({
        title: 'Error',
        description: 'Failed to process Excel file. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 bg-gradient-primary bg-clip-text text-transparent">
            AI TRUEST™
          </h1>
          <p className="text-xl text-muted-foreground">
            Intelligent Pricing Optimization System
          </p>
        </div>

        <Card className="p-8 shadow-elegant">
          <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2">
            <Upload className="w-6 h-6 text-primary" />
            Upload Your Product Data
          </h2>

          {/* Download Template Button */}
          <div className="mb-6">
            <Button
              onClick={generateExcelTemplate}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Excel Template
            </Button>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`
              border-2 border-dashed rounded-lg p-12 text-center transition-all duration-300
              ${isDragging ? 'border-primary bg-primary/5' : 'border-border'}
              ${isProcessing ? 'opacity-50 pointer-events-none' : 'cursor-pointer hover:border-primary'}
            `}
          >
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
              disabled={isProcessing}
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">
                {isProcessing ? 'Processing...' : 'Drag & Drop Excel or CSV File Here'}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Supported: .xlsx, .xls, .csv (Max 5MB)
              </p>
            </label>
          </div>

          {/* Validation Errors */}
          {errors.length > 0 && (
            <Alert variant="destructive" className="mt-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">Validation Errors:</p>
                <ul className="list-disc pl-5 space-y-1">
                  {errors.slice(0, 10).map((err, idx) => (
                    <li key={idx} className="text-sm">
                      Row {err.row}, {err.field}: {err.message}
                    </li>
                  ))}
                  {errors.length > 10 && (
                    <li className="text-sm font-semibold">
                      ... and {errors.length - 10} more error(s)
                    </li>
                  )}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Requirements */}
          <div className="mt-8 space-y-4">
            <h3 className="font-semibold text-lg">Required Columns:</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• <strong>Product Name</strong> - Text description of your product</li>
              <li>• <strong>Category</strong> - Must match exactly from the 14 allowed categories</li>
              <li>• <strong>Current Price</strong> - Your current selling price (must be positive)</li>
              <li>• <strong>Current Quantity</strong> - Monthly sales volume (integer)</li>
              <li>• <strong>Cost per Unit</strong> - Your cost (must be less than current price)</li>
              <li>• <strong>Currency</strong> - SAR or USD</li>
            </ul>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Important:</strong> Category must be selected from the dropdown in Excel.
                Cost must be less than current price. All fields are required.
              </AlertDescription>
            </Alert>
          </div>

          {/* Footer */}
          <footer className="text-center py-8 border-t border-border/50 mt-8">
            <p className="text-sm text-muted-foreground mb-2">
              © 2025 AI Truest, Saudi Arabia. All Rights Reserved.
            </p>
            <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground">
              <span>📩 <a href="mailto:info@paybacksa.com" className="hover:text-primary hover:underline">info@paybacksa.com</a></span>
              <span>•</span>
              <span>📍 Riyadh, Saudi Arabia</span>
            </div>
          </footer>
        </Card>
      </div>
    </div>
  );
};
