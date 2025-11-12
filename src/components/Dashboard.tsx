import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, DollarSign, Package, AlertCircle, ArrowUp, LogOut, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';

interface DashboardProps {
  onNavigateToUpload: () => void;
}

const Dashboard = ({ onNavigateToUpload }: DashboardProps) => {
  const navigate = useNavigate();
  // Mock data - will be replaced with real data
  const metrics = {
    profitIncrease: 12.5,
    revenue: 45200,
    productsOptimized: 23,
    activeAlerts: 5,
  };

  const alerts = [
    {
      id: 1,
      type: 'warning',
      product: 'Wireless Headphones',
      message: 'Competitor dropped price 15%',
      action: 'Review pricing',
    },
    {
      id: 2,
      type: 'warning',
      product: 'USB Cable',
      message: 'Your price 20% above market average',
      action: 'Risk: Losing customers',
    },
  ];

  const opportunities = [
    {
      id: 1,
      product: 'Wireless Mouse',
      potential: 230,
    },
    {
      id: 2,
      product: 'HDMI Cable',
      potential: 180,
    },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/auth');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-primary rounded-xl flex items-center justify-center shadow-glow">
                <span className="text-xl font-bold text-white">AT</span>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-primary">AI TRUEST™</h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last updated: 2 minutes ago • Currency: SAR
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={() => navigate('/products')} variant="outline" className="flex items-center gap-2">
                <Package className="w-4 h-4" />
                View All Products
              </Button>
              <Button onClick={onNavigateToUpload} className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload Products
              </Button>
              <Button variant="outline" onClick={handleLogout} className="flex items-center gap-2">
                <LogOut className="w-4 h-4" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8 space-y-8">
        {/* Welcome Message */}
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-2">👋 Welcome back, Merchant</h2>
        </div>

        {/* Quick Metrics */}
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle className="text-xl">📊 Quick Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* Profit Increase */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-success">
                  <TrendingUp className="w-5 h-5" />
                  <span className="text-3xl font-bold">+{metrics.profitIncrease}%</span>
                </div>
                <p className="text-sm font-medium text-foreground">Profit Increase</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <ArrowUp className="w-3 h-3" /> vs last month
                </p>
              </div>

              {/* Revenue */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <DollarSign className="w-5 h-5" />
                  <span className="text-3xl font-bold">SAR {metrics.revenue.toLocaleString()}</span>
                </div>
                <p className="text-sm font-medium text-foreground">Revenue This Month</p>
                <p className="text-xs text-muted-foreground">+8.2% from last month</p>
              </div>

              {/* Products Optimized */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <Package className="w-5 h-5" />
                  <span className="text-3xl font-bold">{metrics.productsOptimized}</span>
                </div>
                <p className="text-sm font-medium text-foreground">Products Optimized</p>
                <p className="text-xs text-muted-foreground">Out of 30 total</p>
              </div>

              {/* Active Alerts */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-warning">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-3xl font-bold">{metrics.activeAlerts}</span>
                </div>
                <p className="text-sm font-medium text-foreground">Active Alerts</p>
                <p className="text-xs text-muted-foreground">Require attention</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Active Price Alerts */}
        {alerts.length > 0 && (
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-warning" />
                Active Price Alerts
              </CardTitle>
              <CardDescription>
                Important pricing changes detected in the market
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {alerts.map((alert) => (
                <Alert key={alert.id} className="border-warning/50 bg-warning-light">
                  <AlertCircle className="h-4 w-4 text-warning" />
                  <AlertDescription className="ml-2">
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">
                        {alert.message} on "{alert.product}"
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {alert.action} →
                      </p>
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Revenue & Profit Trend Placeholder */}
        <Card className="shadow-elegant">
          <CardHeader>
            <CardTitle className="text-xl">📈 Revenue & Profit Trend</CardTitle>
            <CardDescription>Last 30 Days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg border-2 border-dashed border-muted">
              <p className="text-muted-foreground">Interactive chart will be displayed here</p>
            </div>
          </CardContent>
        </Card>

        {/* Bottom Grid - Opportunities & Market Position */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Optimization Opportunities */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl">🎯 Optimization Opportunities</CardTitle>
              <CardDescription>Top products to optimize for maximum profit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {opportunities.map((opp, index) => (
                <div key={opp.id} className="flex items-center justify-between p-4 bg-accent/50 rounded-lg">
                  <div>
                    <p className="font-semibold text-foreground">
                      {index + 1}. {opp.product}
                    </p>
                    <p className="text-sm text-success font-medium">
                      Potential: +SAR {opp.potential}/month
                    </p>
                  </div>
                  <Button size="sm">Optimize Now</Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Market Position */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="text-xl">📊 Market Position</CardTitle>
              <CardDescription>Your products vs market average</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64 flex flex-col items-center justify-center bg-muted/20 rounded-lg border-2 border-dashed border-muted space-y-4">
                <p className="text-muted-foreground">Scatter plot visualization</p>
                <div className="flex gap-4 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-destructive"></span>
                    Above market
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-primary"></span>
                    At market
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-success"></span>
                    Below market
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
