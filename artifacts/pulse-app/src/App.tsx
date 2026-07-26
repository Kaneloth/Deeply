import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SparksProvider } from '@/contexts/SparksContext';
import { AppShell } from '@/components/AppShell';
import NotFound from '@/pages/not-found';

import AuthPage from '@/pages/AuthPage';
import OnboardingPage from '@/pages/OnboardingPage';
import DiscoverPage from '@/pages/DiscoverPage';
import SearchPage from '@/pages/SearchPage';
import InvitesPage from '@/pages/InvitesPage';
import MatchesPage from '@/pages/MatchesPage';
import MatchDetailPage from '@/pages/MatchDetailPage';
import ChatPage from '@/pages/ChatPage';
import SparksPage from '@/pages/SparksPage';
import ProfilePage from '@/pages/ProfilePage';
import SettingsPage from '@/pages/SettingsPage';

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, ...rest }: any) {
  const { isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }
  
  return <Component {...rest} />;
}

function PublicRoute({ component: Component, ...rest }: any) {
  const { isAuthenticated } = useAuth();
  
  if (isAuthenticated) {
    return <Redirect to="/discover" />;
  }
  
  return <Component {...rest} />;
}

function Router() {
  return (
    <AppShell>
      <Switch>
        {/* Public Routes */}
        <Route path="/" component={() => <PublicRoute component={AuthPage} />} />
        
        {/* Protected Routes */}
        <Route path="/onboarding" component={() => <ProtectedRoute component={OnboardingPage} />} />
        <Route path="/discover" component={() => <ProtectedRoute component={DiscoverPage} />} />
        <Route path="/search" component={() => <ProtectedRoute component={SearchPage} />} />
        <Route path="/invites" component={() => <ProtectedRoute component={InvitesPage} />} />
        <Route path="/matches" component={() => <ProtectedRoute component={MatchesPage} />} />
        <Route path="/matches/:matchId" component={() => <ProtectedRoute component={MatchDetailPage} />} />
        <Route path="/matches/:matchId/chat" component={() => <ProtectedRoute component={ChatPage} />} />
        <Route path="/sparks" component={() => <ProtectedRoute component={SparksPage} />} />
        <Route path="/profile" component={() => <ProtectedRoute component={ProfilePage} />} />
        <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
        
        {/* Catch all */}
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <SparksProvider>
              <Router />
            </SparksProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
