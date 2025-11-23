import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Dashboard from '@/components/Dashboard';
import { UploadPage } from '@/components/UploadPage';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { LogOut, Home, Upload } from 'lucide-react';
const Index = () => {
  const navigate = useNavigate();

  // Check URL parameters for initial view
  const searchParams = new URLSearchParams(window.location.search);
  const initialView = searchParams.get('view') === 'upload' ? 'upload' : 'dashboard';
  const [currentView, setCurrentView] = useState<'dashboard' | 'upload'>(initialView);
  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };
  const handleViewChange = (view: 'dashboard' | 'upload') => {
    setCurrentView(view);
  };
  return <div className="min-h-screen bg-background">
      {currentView === 'dashboard' ? <Dashboard onNavigateToUpload={() => handleViewChange('upload')} /> : <div className="min-h-screen bg-background">
          <header className="border-b bg-card sticky top-0 z-50 shadow-sm">
            <div className="container mx-auto px-4 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center shadow-glow">
                  <span className="text-xl font-bold text-primary-foreground">AT</span>
                </div>
                <h1 className="text-2xl font-bold text-primary">AI TRUEST™</h1>
              </div>
              
              <div className="flex items-center gap-4">
                <nav className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => setCurrentView('dashboard')} className="flex items-center gap-2">
                    <Home className="w-4 h-4" />
                    Dashboard
                  </Button>
                  <Button variant="default" onClick={() => setCurrentView('upload')} className="flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Upload
                  </Button>
                </nav>
                
                <Button variant="outline" onClick={handleLogout} className="flex items-center gap-2">
                  <LogOut className="w-4 h-4" />
                  Logout
                </Button>
              </div>
            </div>
          </header>
          
          <div className="container mx-auto px-4 py-8">
            <UploadPage />
          </div>
        </div>}
    </div>;
};
export default Index;