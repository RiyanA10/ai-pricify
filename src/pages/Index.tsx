import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Dashboard from '@/components/Dashboard';
import { UploadPage } from '@/components/UploadPage';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, LogIn, Home, Upload } from 'lucide-react';
import { User } from '@supabase/supabase-js';

const Index = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);

  // Check URL parameters for initial view - default to upload (search page)
  const searchParams = new URLSearchParams(window.location.search);
  const initialView = searchParams.get('view') === 'dashboard' ? 'dashboard' : 'upload';
  const [currentView, setCurrentView] = useState<'dashboard' | 'upload'>(initialView);

  useEffect(() => {
    // Check current auth state
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleViewChange = (view: 'dashboard' | 'upload') => {
    setCurrentView(view);
  };

  return (
    <div className="min-h-screen bg-background">
      {currentView === 'dashboard' ? (
        <Dashboard onNavigateToUpload={() => handleViewChange('upload')} />
      ) : (
        <div className="min-h-screen bg-background">
          {/* Header with consistent styling matching Dashboard */}
          <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">
              {/* Logo section */}
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center shadow-glow">
                  <span className="text-xl font-bold text-primary-foreground">AT</span>
                </div>
                <h1 className="text-2xl font-bold text-primary">AI TRUEST™</h1>
              </div>

              {/* Navigation with consistent button variants */}
              <div className="flex items-center gap-3">
                <nav className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setCurrentView('dashboard')}
                    className="flex items-center gap-2"
                  >
                    <Home className="w-4 h-4" />
                    Dashboard
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => setCurrentView('upload')}
                    className="flex items-center gap-2"
                  >
                    <Upload className="w-4 h-4" />
                    Upload
                  </Button>
                </nav>

                {user ? (
                  <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => navigate('/auth')}
                    className="flex items-center gap-2"
                  >
                    <LogIn className="w-4 h-4" />
                    Sign In
                  </Button>
                )}
              </div>
            </div>
          </header>

          <div className="container mx-auto px-4 py-8">
            <UploadPage />
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;