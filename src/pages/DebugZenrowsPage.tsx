import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DebugZenrowsPage = () => {
  const [marketplace, setMarketplace] = useState("amazon");
  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState("");
  const [preview, setPreview] = useState("");
  const { toast } = useToast();

  const marketplaceUrls: Record<string, string> = {
    amazon: "https://www.amazon.com/s?k=apple+iphone+17+pro+max+256gb+deep+blue",
    walmart: "https://www.walmart.com/search?q=apple+iphone+17+pro+max+256gb+deep+blue",
    ebay: "https://www.ebay.com/sch/i.html?_nkw=apple+iphone+17+pro+max+256gb+deep+blue",
    target: "https://www.target.com/s?searchTerm=apple+iphone+17+pro+max+256gb+deep+blue",
  };

  const fetchHtml = async () => {
    setLoading(true);
    setHtml("");
    setPreview("");

    try {
      const { data, error } = await supabase.functions.invoke('debug-zenrows', {
        body: { 
          url: marketplaceUrls[marketplace],
          marketplace 
        }
      });

      if (error) throw error;

      if (data.success) {
        setHtml(data.html);
        setPreview(data.preview);
        toast({
          title: "HTML Fetched",
          description: `Retrieved ${data.htmlLength.toLocaleString()} characters from ${marketplace}`,
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('Error:', error);
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">ZenRows HTML Debug</h1>
          <p className="text-muted-foreground">
            Inspect raw HTML returned by ZenRows for different marketplaces
          </p>
        </div>

        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium mb-2 block">Marketplace</label>
                <Select value={marketplace} onValueChange={setMarketplace}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="amazon">Amazon</SelectItem>
                    <SelectItem value="walmart">Walmart</SelectItem>
                    <SelectItem value="ebay">eBay</SelectItem>
                    <SelectItem value="target">Target</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={fetchHtml} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Fetching...
                    </>
                  ) : (
                    "Fetch HTML"
                  )}
                </Button>
              </div>
            </div>

            {preview && (
              <div>
                <label className="text-sm font-medium mb-2 block">Preview (first 1000 chars)</label>
                <Textarea
                  value={preview}
                  readOnly
                  className="font-mono text-xs h-40"
                />
              </div>
            )}

            {html && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm font-medium">Full HTML ({html.length.toLocaleString()} chars)</label>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(html);
                      toast({ title: "Copied to clipboard" });
                    }}
                  >
                    Copy HTML
                  </Button>
                </div>
                <Textarea
                  value={html}
                  readOnly
                  className="font-mono text-xs h-96"
                />
              </div>
            )}
          </div>
        </Card>

        <Card className="p-6 bg-muted">
          <h3 className="font-semibold mb-2">URL being fetched:</h3>
          <code className="text-xs break-all">{marketplaceUrls[marketplace]}</code>
        </Card>
      </div>
    </div>
  );
};

export default DebugZenrowsPage;
