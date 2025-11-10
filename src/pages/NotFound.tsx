import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Home, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-hero p-4">
      <Card className="max-w-md w-full p-8 text-center shadow-elegant animate-scale-in">
        <div className="mb-6 relative">
          <div className="w-24 h-24 mx-auto bg-gradient-primary rounded-full flex items-center justify-center shadow-glow">
            <AlertCircle className="w-12 h-12 text-white" />
          </div>
        </div>
        
        <h1 className="text-7xl font-bold mb-3 bg-gradient-primary bg-clip-text text-transparent">
          404
        </h1>
        
        <h2 className="text-2xl font-semibold mb-3">Page Not Found</h2>
        
        <p className="text-muted-foreground mb-8">
          The page you're looking for doesn't exist or has been moved.
        </p>
        
        <Link to="/">
          <Button size="lg" className="shadow-lg hover:shadow-glow transition-all">
            <Home className="w-5 h-5 mr-2" />
            Return to Home
          </Button>
        </Link>
      </Card>
    </div>
  );
};

export default NotFound;
