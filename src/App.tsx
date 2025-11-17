import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import ProcessingPage from "./pages/ProcessingPage";
import ResultsPage from "./pages/ResultsPage";
import ProductListPage from "./pages/ProductListPage";
import { CompetitiveIntelligencePage } from "./pages/CompetitiveIntelligencePage";
import DebugZenrowsPage from "./pages/DebugZenrowsPage";
import NotFound from "./pages/NotFound";
import AuthPage from "./pages/AuthPage";
import VerificationPage from "./pages/VerificationPage";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/verify" element={<VerificationPage />} />
          <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute><ProductListPage /></ProtectedRoute>} />
          <Route path="/competitive-intelligence" element={<ProtectedRoute><CompetitiveIntelligencePage /></ProtectedRoute>} />
          <Route path="/debug-zenrows" element={<ProtectedRoute><DebugZenrowsPage /></ProtectedRoute>} />
          <Route path="/processing/:baselineId" element={<ProtectedRoute><ProcessingPage /></ProtectedRoute>} />
          <Route path="/results/:baselineId" element={<ProtectedRoute><ResultsPage /></ProtectedRoute>} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
