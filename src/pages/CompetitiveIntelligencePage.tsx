import { ArrowLeft, TrendingUp, TrendingDown, Target, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

export const CompetitiveIntelligencePage = () => {
  const navigate = useNavigate();

  const competitors = [
    { name: "Amazon", avgPrice: 899, trend: "down", change: -5.2, position: "Leader" },
    { name: "Noon", avgPrice: 949, trend: "up", change: 2.1, position: "Challenger" },
    { name: "Extra", avgPrice: 1050, trend: "stable", change: 0.5, position: "Follower" },
    { name: "Jarir", avgPrice: 975, trend: "down", change: -1.8, position: "Follower" },
  ];

  const insights = [
    {
      type: "opportunity",
      title: "Price Gap Opportunity",
      description: "15% of your products are priced 20% above Amazon's baseline",
      impact: "High"
    },
    {
      type: "warning",
      title: "Competitive Pressure",
      description: "Noon has reduced prices on 8 similar products in the last week",
      impact: "Medium"
    },
    {
      type: "info",
      title: "Market Trend",
      description: "Electronics category showing 3% price decrease trend this month",
      impact: "Low"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="mb-6 hover:bg-muted/50"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>

        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent mb-2">
            Competitive Intelligence
          </h1>
          <p className="text-muted-foreground">
            Track competitor pricing strategies and identify market opportunities
          </p>
        </div>

        {/* Market Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Market Leader</div>
            <div className="text-2xl font-bold text-foreground">Amazon</div>
            <div className="text-sm text-success flex items-center gap-1 mt-1">
              <TrendingDown className="h-4 w-4" />
              -5.2% this week
            </div>
          </Card>

          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Avg Price Gap</div>
            <div className="text-2xl font-bold text-foreground">12.5%</div>
            <div className="text-sm text-warning flex items-center gap-1 mt-1">
              <Target className="h-4 w-4" />
              Above market
            </div>
          </Card>

          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Active Competitors</div>
            <div className="text-2xl font-bold text-foreground">4</div>
            <div className="text-sm text-muted-foreground mt-1">
              Tracked platforms
            </div>
          </Card>

          <Card className="p-6 bg-card/50 backdrop-blur border-border/50 hover:shadow-lg transition-all">
            <div className="text-sm text-muted-foreground mb-2">Price Updates</div>
            <div className="text-2xl font-bold text-foreground">23</div>
            <div className="text-sm text-info flex items-center gap-1 mt-1">
              <TrendingUp className="h-4 w-4" />
              Last 24 hours
            </div>
          </Card>
        </div>

        {/* Competitor Analysis */}
        <Card className="p-6 mb-8 bg-card/50 backdrop-blur border-border/50">
          <h2 className="text-xl font-semibold mb-6 text-foreground">Competitor Overview</h2>
          <div className="space-y-4">
            {competitors.map((competitor) => (
              <div
                key={competitor.name}
                className="flex items-center justify-between p-4 rounded-lg border border-border/50 hover:border-primary/50 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-subtle flex items-center justify-center font-bold text-foreground">
                    {competitor.name[0]}
                  </div>
                  <div>
                    <div className="font-semibold text-foreground">{competitor.name}</div>
                    <div className="text-sm text-muted-foreground">
                      Avg Price: SAR {competitor.avgPrice}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <Badge variant={competitor.position === "Leader" ? "default" : "secondary"}>
                    {competitor.position}
                  </Badge>
                  
                  <div className={`flex items-center gap-2 ${
                    competitor.trend === "down" ? "text-success" : 
                    competitor.trend === "up" ? "text-error" : 
                    "text-muted-foreground"
                  }`}>
                    {competitor.trend === "down" && <TrendingDown className="h-5 w-5" />}
                    {competitor.trend === "up" && <TrendingUp className="h-5 w-5" />}
                    <span className="font-semibold">
                      {competitor.change > 0 ? "+" : ""}{competitor.change}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Market Insights */}
        <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
          <h2 className="text-xl font-semibold mb-6 text-foreground">Market Insights</h2>
          <div className="space-y-4">
            {insights.map((insight, idx) => (
              <div
                key={idx}
                className="p-4 rounded-lg border border-border/50 hover:border-primary/30 transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${
                    insight.type === "opportunity" ? "bg-success/10" :
                    insight.type === "warning" ? "bg-warning/10" :
                    "bg-info/10"
                  }`}>
                    <AlertCircle className={`h-5 w-5 ${
                      insight.type === "opportunity" ? "text-success" :
                      insight.type === "warning" ? "text-warning" :
                      "text-info"
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-semibold text-foreground">{insight.title}</h3>
                      <Badge variant={
                        insight.impact === "High" ? "destructive" :
                        insight.impact === "Medium" ? "default" :
                        "secondary"
                      }>
                        {insight.impact} Impact
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{insight.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
