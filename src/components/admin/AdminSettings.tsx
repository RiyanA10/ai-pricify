import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Settings, Key, Globe, Zap } from 'lucide-react';

const AdminSettings = () => {
  return (
    <div className="space-y-6">
      {/* ScrapingBee API Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            ScrapingBee API Configuration
          </CardTitle>
          <CardDescription>Manage your ScrapingBee API key for competitor scraping</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key</Label>
            <div className="flex gap-2">
              <Input 
                id="api-key"
                type="password"
                placeholder="••••••••••••••••"
                disabled
              />
              <Button variant="outline">Update</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              API key is securely stored. Contact system administrator to update.
            </p>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium mb-3">API Usage (Coming Soon)</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Credits Used</p>
                <p className="text-xl font-bold">N/A</p>
              </div>
              <div className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Credits Remaining</p>
                <p className="text-xl font-bold">N/A</p>
              </div>
              <div className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Requests Today</p>
                <p className="text-xl font-bold">N/A</p>
              </div>
              <div className="border rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Avg Response Time</p>
                <p className="text-xl font-bold">N/A</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Marketplace Configurations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Marketplace Configurations
          </CardTitle>
          <CardDescription>Configure scraping parameters for each marketplace</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {['Amazon', 'eBay', 'Google Shopping'].map((marketplace) => (
              <div key={marketplace} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium">{marketplace}</h4>
                  <Badge variant="outline">Active</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Wait Time</p>
                    <p className="font-medium">2000ms</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Block Resources</p>
                    <p className="font-medium">Yes</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* System Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            System Settings
          </CardTitle>
          <CardDescription>Global system configuration and feature toggles</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <p className="font-medium">Maintenance Mode</p>
                <p className="text-sm text-muted-foreground">Disable new uploads and processing</p>
              </div>
              <Badge variant="outline">Disabled</Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <p className="font-medium">Auto-Refresh Competitors</p>
                <p className="text-sm text-muted-foreground">Automatically update competitor data</p>
              </div>
              <Badge variant="default">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between p-3 border rounded-lg">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-muted-foreground">Send alerts for critical events</p>
              </div>
              <Badge variant="default">Enabled</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance Monitoring */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Performance Monitoring
          </CardTitle>
          <CardDescription>System health and performance metrics</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Zap className="h-12 w-12 text-muted-foreground mb-3" />
            <h4 className="font-semibold mb-2">Advanced Monitoring Coming Soon</h4>
            <p className="text-sm text-muted-foreground max-w-md">
              Real-time performance metrics, error tracking, and system health monitoring will be available in a future update.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSettings;

