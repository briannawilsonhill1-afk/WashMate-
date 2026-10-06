import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { useAuth } from "@/hooks/use-auth";
import { Navbar } from "@/components/layout/Navbar";
import AuthPage from "@/pages/AuthPage";
import RoleSelection from "@/pages/RoleSelection";
import CustomerDashboard from "@/pages/CustomerDashboard";
import WasherDashboard from "@/pages/WasherDashboard";
import PrivacyPolicy from "@/pages/PrivacyPolicy";
import WasherProfile from "@/pages/WasherProfile";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

function ProtectedRoute({ component: Component, allowedRole }: { component: any, allowedRole: 'customer' | 'washer' }) {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) return <Redirect to="/" />;
  if (!user?.role) return <Redirect to="/welcome" />;

  if (user.role !== allowedRole) {
    return <Redirect to={user.role === 'customer' ? "/customer" : "/washer"} />;
  }

  return <Component />;
}

function Router() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) return <LoadingScreen />;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Switch>
          <Route path="/">
            {!isAuthenticated ? (
              <AuthPage />
            ) : !user?.role ? (
              <Redirect to="/welcome" />
            ) : (
              <Redirect to={user.role === 'customer' ? "/customer" : "/washer"} />
            )}
          </Route>

          <Route path="/welcome">
            {!isAuthenticated ? <Redirect to="/" /> : user?.role ? <Redirect to={user.role === 'customer' ? "/customer" : "/washer"} /> : <RoleSelection />}
          </Route>

          <Route path="/customer">
            <ProtectedRoute component={CustomerDashboard} allowedRole="customer" />
          </Route>

          <Route path="/washer">
            <ProtectedRoute component={WasherDashboard} allowedRole="washer" />
          </Route>

          <Route path="/washer/profile">
            <ProtectedRoute component={WasherProfile} allowedRole="washer" />
          </Route>

          <Route path="/privacy">
            <PrivacyPolicy />
          </Route>

          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
