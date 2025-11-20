import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings } from 'lucide-react';

const AdminSettings = () => {
  return (
    <Card>
      <CardHeader>
        <CardTitle>System Settings</CardTitle>
        <CardDescription>Configure system-wide settings and API keys</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Settings className="h-16 w-16 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">Settings Coming Soon</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Admin settings panel will include API key management, marketplace configurations, 
            and system-wide feature toggles.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default AdminSettings;
