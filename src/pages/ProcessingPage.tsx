import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle, Clock, AlertCircle, ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function ProcessingPage() {
  const { baselineId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState({
    upload: 'completed',
    inflation: 'processing',
    competitors: 'pending',
    calculation: 'pending',
  });

  useEffect(() => {
    if (!baselineId) {
      navigate('/');
      return;
    }

    // Start processing automatically
    startProcessing();

    // Poll for status updates
    const interval = setInterval(checkProcessingStatus, 2000);

    return () => clearInterval(interval);
  }, [baselineId]);

  const startProcessing = async () => {
    try {
      // Trigger the processing edge function
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
        .single();

      if (error) throw error;

      if (data?.status === 'completed') {
        navigate(`/results/${baselineId}`);
      } else if (data?.status === 'failed') {
        toast({
          title: 'Processing Failed',
          description: data.error_message || 'An error occurred during processing',
          variant: 'destructive',
        });
        navigate('/');
      }

      // Update UI status based on current_step
      const step = data?.current_step || '';
      setStatus({
        upload: 'completed',
        inflation: step.includes('inflation') || step.includes('competitor') || step.includes('calculation') ? 'completed' : 'processing',
        competitors: step.includes('competitor') || step.includes('calculation') ? 'processing' : 'pending',
        calculation: step.includes('calculation') ? 'processing' : 'pending',
      });

    } catch (error) {
      console.error('Failed to check status:', error);
    }
  };

  const getStatusIcon = (stepStatus: string) => {
    switch (stepStatus) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-success" />;
      case 'processing':
        return <Loader2 className="w-5 h-5 text-primary animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-muted-foreground" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero p-4 animate-fade-in">
      <div className="max-w-2xl mx-auto pt-8">
        {/* Back Button */}
        <Button
          variant="outline"
          onClick={() => navigate('/')}
          className="mb-6 hover:shadow-lg transition-all animate-slide-up"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Upload
        </Button>

        <Card className="w-full p-8 md:p-10 shadow-elegant hover:shadow-glow transition-all animate-scale-in backdrop-blur-sm bg-white/95">
        <div className="text-center mb-10">
          <div className="relative inline-block mb-6">
            <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
            <Loader2 className="w-20 h-20 mx-auto text-primary animate-spin relative" />
          </div>
          <h1 className="text-4xl font-bold mb-3 bg-gradient-primary bg-clip-text text-transparent">
            Processing Your Data
          </h1>
          <p className="text-lg text-muted-foreground">
            ✨ AI analysis in progress • Typically 30-60 seconds
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-4 p-5 rounded-xl bg-gradient-card border border-primary/10 hover:border-primary/30 transition-all">
            {getStatusIcon(status.upload)}
            <div className="flex-1">
              <p className="font-semibold text-lg">Excel uploaded successfully</p>
              <p className="text-sm text-muted-foreground">✓ Product data validated</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-5 rounded-xl bg-gradient-card border border-primary/10 hover:border-primary/30 transition-all">
            {getStatusIcon(status.inflation)}
            <div className="flex-1">
              <p className="font-semibold text-lg">Fetching SAMA inflation rate</p>
              <p className="text-sm text-muted-foreground">📊 Retrieving latest economic data</p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-5 rounded-xl bg-gradient-card border border-primary/10 hover:border-primary/30 transition-all">
            {getStatusIcon(status.competitors)}
            <div className="flex-1">
              <p className="font-semibold text-lg">Searching competitor prices</p>
              <p className="text-sm text-muted-foreground">
                🛒 Amazon, Noon, Extra, Jarir...
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 p-5 rounded-xl bg-gradient-card border border-primary/10 hover:border-primary/30 transition-all">
            {getStatusIcon(status.calculation)}
            <div className="flex-1">
              <p className="font-semibold text-lg">Calculating optimal price</p>
              <p className="text-sm text-muted-foreground">🤖 AI elasticity calibration in progress</p>
            </div>
          </div>
        </div>

        <div className="mt-8 p-6 bg-gradient-card rounded-xl border-2 border-primary/20 shadow-lg">
          <div className="flex gap-3">
            <div className="p-2 bg-primary/10 rounded-lg h-fit">
              <AlertCircle className="w-6 h-6 text-primary" />
            </div>
            <div>
              <p className="font-bold text-lg text-primary mb-2">What's happening?</p>
              <p className="text-muted-foreground leading-relaxed">
                Our AI is analyzing your product against real market data, calculating
                demand elasticity with SAMA inflation adjustments, and calibrating the
                optimal price to maximize your profits.
              </p>
            </div>
          </div>
        </div>
        </Card>
      </div>
    </div>
  );
}
