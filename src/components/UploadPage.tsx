import { useState, useEffect, useRef } from 'react';
import { Check, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CATEGORY_ELASTICITY } from '@/utils/categoryElasticity';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { User } from '@supabase/supabase-js';

const CATEGORIES = [
  'Electronics',
  'Fashion & Apparel',
  'Home & Garden',
  'Beauty & Personal Care',
  'Sports & Outdoors',
  'Toys & Games',
  'Books & Media',
  'Automotive',
  'Grocery & Food',
  'Health & Wellness',
  'Office Supplies',
  'Pet Supplies',
  'Jewelry & Watches',
  'Industrial & Scientific',
];

type Step = 'product_name' | 'category' | 'current_price' | 'current_quantity' | 'cost_per_unit' | 'currency';

interface FormData {
  product_name: string;
  category: string;
  current_price: string;
  current_quantity: string;
  cost_per_unit: string;
  currency: 'SAR' | 'USD';
}

export const UploadPage = () => {
  const [currentStep, setCurrentStep] = useState<Step>('product_name');
  const [formData, setFormData] = useState<FormData>({
    product_name: '',
    category: '',
    current_price: '',
    current_quantity: '',
    cost_per_unit: '',
    currency: 'SAR',
  });
  const [completedSteps, setCompletedSteps] = useState<Set<Step>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const steps: Step[] = ['product_name', 'category', 'current_price', 'current_quantity', 'cost_per_unit', 'currency'];

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });
  }, []);

  useEffect(() => {
    if (inputRef.current && !isProcessing) {
      inputRef.current.focus();
    }
  }, [currentStep, isProcessing]);

  const getStepLabel = (step: Step): string => {
    const labels: Record<Step, string> = {
      product_name: 'What product are you selling?',
      category: 'Which category does it belong to?',
      current_price: 'How much do you charge now?',
      current_quantity: 'How many do you sell monthly?',
      cost_per_unit: "What's your cost per unit?",
      currency: 'Which currency do you use?',
    };
    return labels[step];
  };

  const handleNext = () => {
    const currentIndex = steps.indexOf(currentStep);
    
    // Validate current step
    if (currentStep === 'product_name' && !formData.product_name.trim()) {
      toast({ title: 'Please enter a product name', variant: 'destructive' });
      return;
    }
    if (currentStep === 'category' && !formData.category) {
      toast({ title: 'Please select a category', variant: 'destructive' });
      return;
    }
    if (currentStep === 'current_price' && (!formData.current_price || Number(formData.current_price) <= 0)) {
      toast({ title: 'Please enter a valid price', variant: 'destructive' });
      return;
    }
    if (currentStep === 'current_quantity' && (!formData.current_quantity || Number(formData.current_quantity) <= 0)) {
      toast({ title: 'Please enter a valid quantity', variant: 'destructive' });
      return;
    }
    if (currentStep === 'cost_per_unit' && (!formData.cost_per_unit || Number(formData.cost_per_unit) <= 0)) {
      toast({ title: 'Please enter a valid cost', variant: 'destructive' });
      return;
    }

    // Mark current step as completed
    setCompletedSteps(prev => new Set([...prev, currentStep]));

    // Move to next step or submit
    if (currentIndex < steps.length - 1) {
      setCurrentStep(steps[currentIndex + 1]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNext();
    }
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({
        title: 'Authentication required',
        description: 'Please sign in to continue',
        variant: 'destructive',
      });
      navigate('/auth');
      return;
    }

    setIsProcessing(true);

    try {
      // Validate cost < price
      if (Number(formData.cost_per_unit) >= Number(formData.current_price)) {
        toast({
          title: 'Invalid data',
          description: 'Cost per unit must be less than current price',
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      }

      const productData = {
        merchant_id: user.id,
        product_name: formData.product_name,
        category: formData.category,
        current_price: Number(formData.current_price),
        current_quantity: Number(formData.current_quantity),
        cost_per_unit: Number(formData.cost_per_unit),
        currency: formData.currency,
        base_elasticity: CATEGORY_ELASTICITY[formData.category],
      };

      const { data: insertedProduct, error: insertError } = await supabase
        .from('product_baselines')
        .insert(productData)
        .select()
        .single();

      if (insertError) throw insertError;

      // Trigger processing
      await supabase.functions.invoke('process-pricing', {
        body: { baseline_id: insertedProduct.id }
      });

      toast({
        title: 'Success!',
        description: 'Product uploaded and processing started',
      });

      navigate(`/processing/${insertedProduct.id}`);

    } catch (error) {
      console.error('Error submitting form:', error);
      toast({
        title: 'Error',
        description: 'Failed to submit product. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  const allCompleted = completedSteps.size === steps.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-8 animate-fade-in">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-lg font-bold text-primary-foreground">AT</span>
            </div>
            <h1 className="text-3xl font-bold text-primary">AI TRUEST</h1>
          </div>
          <Button
            onClick={handleSignOut}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>

        {/* Progress Dots */}
        <div className="flex justify-center gap-2 mb-12">
          {steps.map((step) => (
            <div
              key={step}
              className={`h-2 w-2 rounded-full transition-all duration-500 ${
                completedSteps.has(step)
                  ? 'bg-primary w-8'
                  : currentStep === step
                  ? 'bg-primary/50 w-4'
                  : 'bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Chat Container */}
        <div className="space-y-6">
          {/* Completed Steps */}
          {steps.map((step, index) => {
            if (!completedSteps.has(step)) return null;
            
            return (
              <div
                key={step}
                className="animate-slide-up"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <Check className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-muted-foreground mb-2">{getStepLabel(step)}</p>
                    <div className="bg-card border border-border rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
                      <p className="font-medium text-foreground">
                        {step === 'currency' 
                          ? formData[step]
                          : step === 'category'
                          ? formData[step]
                          : step === 'product_name'
                          ? formData[step]
                          : `${formData[step]} ${step === 'current_price' || step === 'cost_per_unit' ? formData.currency : 'units'}`
                        }
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Current Step Input */}
          {!allCompleted && (
            <div className="animate-fade-in">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1 animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-primary-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground mb-3">{getStepLabel(currentStep)}</p>
                  
                  {currentStep === 'category' ? (
                    <Select
                      value={formData.category}
                      onValueChange={(value) => {
                        setFormData({ ...formData, category: value });
                        setTimeout(() => handleNext(), 100);
                      }}
                    >
                      <SelectTrigger className="w-full bg-background border-2 border-primary/20 focus:border-primary rounded-2xl px-4 py-6 text-left shadow-sm">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent className="bg-background">
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : currentStep === 'currency' ? (
                    <div className="flex gap-3">
                      <Button
                        onClick={() => {
                          setFormData({ ...formData, currency: 'SAR' });
                          setTimeout(() => handleNext(), 100);
                        }}
                        variant={formData.currency === 'SAR' ? 'default' : 'outline'}
                        size="lg"
                        className="flex-1 rounded-2xl py-6"
                      >
                        SAR
                      </Button>
                      <Button
                        onClick={() => {
                          setFormData({ ...formData, currency: 'USD' });
                          setTimeout(() => handleNext(), 100);
                        }}
                        variant={formData.currency === 'USD' ? 'default' : 'outline'}
                        size="lg"
                        className="flex-1 rounded-2xl py-6"
                      >
                        USD
                      </Button>
                    </div>
                  ) : (
                    <Input
                      ref={inputRef}
                      type={currentStep === 'product_name' ? 'text' : 'number'}
                      value={formData[currentStep]}
                      onChange={(e) => setFormData({ ...formData, [currentStep]: e.target.value })}
                      onKeyPress={handleKeyPress}
                      placeholder={
                        currentStep === 'product_name'
                          ? 'e.g., iPhone 15 Pro Max'
                          : currentStep === 'current_price'
                          ? 'e.g., 4999'
                          : currentStep === 'current_quantity'
                          ? 'e.g., 50'
                          : 'e.g., 3500'
                      }
                      className="w-full bg-background border-2 border-primary/20 focus:border-primary rounded-2xl px-4 py-6 text-lg shadow-sm"
                      min={currentStep !== 'product_name' ? '0' : undefined}
                      step={currentStep !== 'product_name' && currentStep !== 'current_quantity' ? '0.01' : undefined}
                    />
                  )}
                  
                  {currentStep !== 'category' && currentStep !== 'currency' && (
                    <p className="text-xs text-muted-foreground mt-2 ml-1">Press Enter to continue</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Submit Button */}
          {allCompleted && (
            <div className="flex justify-center pt-8 animate-scale-in">
              <Button
                onClick={handleSubmit}
                disabled={isProcessing}
                size="lg"
                className="px-12 py-6 rounded-2xl text-lg shadow-lg hover:shadow-xl transition-all"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  'Start AI Analysis'
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="text-center pt-16 pb-8">
          <p className="text-sm text-muted-foreground">
            © 2025 AI TRUEST™ • Intelligent Pricing Platform
          </p>
        </footer>
      </div>
    </div>
  );
};
