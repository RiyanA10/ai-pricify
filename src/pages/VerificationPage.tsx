import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Mail, CheckCircle, AlertCircle } from 'lucide-react';

const VerificationPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(900); // 15 minutes
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const userEmail = searchParams.get('email') || '';
  const businessName = searchParams.get('business') || '';

  useEffect(() => {
    if (!userEmail) {
      navigate('/auth');
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [userEmail, navigate]);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    
    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);
    
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };
  
  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };
  
  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    const newCode = pastedData.split('');
    setCode([...newCode, ...Array(6 - newCode.length).fill('')]);
    
    const lastIndex = Math.min(newCode.length, 5);
    inputRefs.current[lastIndex]?.focus();
  };
  
  const handleVerify = async () => {
    const verificationCode = code.join('');
    
    if (verificationCode.length !== 6) {
      setError('Please enter all 6 digits');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const { data, error } = await supabase.functions.invoke('verify-email', {
        body: { code: verificationCode }
      });
      
      if (error) throw error;

      if (data.success) {
        toast({
          title: 'Email verified successfully!',
          description: 'You can now sign in with your credentials.',
        });
        setTimeout(() => navigate('/auth'), 2000);
      } else {
        setError(data.error || 'Invalid verification code');
        setCode(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
      }
    } catch (error: any) {
      setError(error.message || 'Verification failed. Please try again.');
      setCode(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };
  
  const handleResendCode = async () => {
    setLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('send-verification', {
        body: { 
          email: userEmail,
          business_name: businessName,
          is_resend: true
        }
      });
      
      if (error) throw error;

      if (data.success) {
        toast({
          title: 'New verification code sent',
          description: 'Check your email for the new code.',
        });
        setTimeLeft(900);
        setCode(['', '', '', '', '', '']);
        setError('');
      }
    } catch (error: any) {
      toast({
        title: 'Failed to resend code',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <Card className="w-full max-w-md shadow-elegant animate-scale-in">
        <CardHeader className="text-center space-y-4">
          <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center mx-auto shadow-glow">
            <Mail className="w-10 h-10 text-white" />
          </div>
          <CardTitle className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            Verify Your Email
          </CardTitle>
          <CardDescription className="text-base">
            We sent a 6-digit code to<br/>
            <strong className="text-foreground text-lg">{userEmail}</strong>
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-center mb-3">
              Enter Verification Code
            </label>
            <div className="flex gap-2 justify-center" onPaste={handlePaste}>
              {code.map((digit, index) => (
                <input
                  key={index}
                  ref={el => inputRefs.current[index] = el}
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleCodeChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  className="w-14 h-16 text-center text-2xl font-bold border-2 border-input rounded-xl focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all disabled:opacity-50 bg-primary-subtle/30 hover:bg-primary-subtle/50"
                  disabled={loading}
                />
              ))}
            </div>
          </div>
          
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          
          <div className="text-center">
            {timeLeft > 0 ? (
              <p className="text-sm text-muted-foreground">
                Code expires in <strong className="text-primary">{formatTime(timeLeft)}</strong>
              </p>
            ) : (
              <p className="text-sm text-destructive font-medium">
                Code expired. Please request a new one.
              </p>
            )}
          </div>
          
          <Button
            onClick={handleVerify}
            disabled={loading || timeLeft === 0}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Verifying...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Verify Email
              </>
            )}
          </Button>
        </CardContent>
        
        <CardFooter className="flex flex-col space-y-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Didn't receive the code?</p>
            <button
              onClick={handleResendCode}
              disabled={loading}
              className="text-primary hover:text-primary/80 font-medium text-sm hover:underline disabled:opacity-50"
            >
              Resend verification code
            </button>
          </div>
          
          <div className="pt-4 border-t text-center">
            <p className="text-xs text-muted-foreground">
              Having trouble? <a href="mailto:info@paybacksa.com" className="text-primary hover:underline">Contact support</a>
            </p>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

export default VerificationPage;