import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle, Clock, ArrowLeft, BarChart3, Search, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const SIMPLE_STEPS = [
  { id: 1, message: "Analyzing market...", icon: BarChart3 },
  { id: 2, message: "Finding best matches...", icon: Search },
  { id: 3, message: "Preparing insights...", icon: Sparkles },
];

export default function ProcessingPage() {
  const { baselineId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(0);
  const [hasStartedProcessing, setHasStartedProcessing] = useState(false);

  useEffect(() => {
    if (!baselineId) {
      navigate('/');
      return;
    }

    // Check if processing already started before triggering
    checkIfProcessingStarted();

    // Poll for status updates
    const interval = setInterval(checkProcessingStatus, 1000);

    // Animate through steps
    const stepInterval = setInterval(() => {
      setCurrentStep(prev => (prev < SIMPLE_STEPS.length - 1 ? prev + 1 : prev));
    }, 8000);

    return () => {
      clearInterval(interval);
      clearInterval(stepInterval);
    };
  }, [baselineId]);

  const checkIfProcessingStarted = async () => {
    try {
      const { data } = await supabase
        .from('processing_status')
        .select('*')
        .eq('baseline_id', baselineId)
        .limit(1)
        .maybeSingle();

      if (!data) {
        await startProcessing();
        setHasStartedProcessing(true);
      } else {
        setHasStartedProcessing(true);
      }
    } catch (error) {
      console.error('Failed to check processing status:', error);
      if (!hasStartedProcessing) {
        await startProcessing();
        setHasStartedProcessing(true);
      }
    }
  };

  const startProcessing = async () => {
    try {
      const { error } = await supabase.functions.invoke('process-pricing', {
        body: { baseline_id: baselineId }
      });

      if (error) throw error;
    } catch (error) {
      console.error('Failed to start processing:', error);
      toast({
        title: 'Error',
        description: 'Failed to start pricing analysis',
        variant: 'destructive',
      });
    }
  };

  const checkProcessingStatus = async () => {
    try {
      const { data, error } = await supabase
        .from('processing_status')
        .select('*')
        .eq('baseline_id', baselineId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data?.status === 'completed') {
        setCurrentStep(SIMPLE_STEPS.length - 1);
        setTimeout(() => navigate(`/results/${baselineId}`), 500);
      } else if (data?.status === 'failed') {
        toast({
          title: 'Processing Failed',
          description: data.error_message || 'An error occurred during processing',
          variant: 'destructive',
        });
        navigate('/');
      }
    } catch (error) {
      console.error('Failed to check status:', error);
    }
  };

  const getStepStatus = (stepIndex: number) => {
    if (stepIndex < currentStep) return 'completed';
    if (stepIndex === currentStep) return 'processing';
    return 'pending';
  };

  const getStatusIcon = (status: string, IconComponent: any) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-6 h-6 text-success" />;
      case 'processing':
        return <Loader2 className="w-6 h-6 text-primary animate-spin" />;
      default:
        return <Clock className="w-6 h-6 text-muted-foreground" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero p-4 animate-fade-in">
      <div className="max-w-xl mx-auto pt-8">
        {/* Back Button */}
        <Button
          variant="outline"
          onClick={() => navigate('/?view=upload')}
          className="mb-6 hover:shadow-lg transition-all animate-slide-up"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Upload
        </Button>

        <Card className="w-full p-8 md:p-10 shadow-elegant hover:shadow-glow transition-all animate-scale-in backdrop-blur-sm bg-white/95">
          <div className="text-center mb-10">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
              <Loader2 className="w-16 h-16 mx-auto text-primary animate-spin relative" />
            </div>
            <h1 className="text-3xl font-bold mb-2 text-primary">
              Analyzing Your Product
            </h1>
            <p className="text-muted-foreground">
              This typically takes 30-60 seconds
            </p>
          </div>

          <div className="space-y-4">
            {SIMPLE_STEPS.map((step, index) => {
              const status = getStepStatus(index);
              const IconComponent = step.icon;
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-4 p-5 rounded-xl border transition-all ${
                    status === 'processing'
                      ? 'bg-primary/5 border-primary/30 shadow-md'
                      : status === 'completed'
                      ? 'bg-success/5 border-success/30'
                      : 'bg-muted/30 border-border'
                  }`}
                >
                  {getStatusIcon(status, IconComponent)}
                  <div className="flex-1">
                    <p className={`font-semibold text-lg ${
                      status === 'processing' ? 'text-primary' :
                      status === 'completed' ? 'text-success' :
                      'text-muted-foreground'
                    }`}>
                      {step.message}
                    </p>
                  </div>
                  <IconComponent className={`w-5 h-5 ${
                    status === 'processing' ? 'text-primary' :
                    status === 'completed' ? 'text-success' :
                    'text-muted-foreground'
                  }`} />
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}