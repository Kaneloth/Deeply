import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useLocation } from 'wouter';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SparksProvider } from '@/contexts/SparksContext';
import { InvitesProvider } from '@/contexts/InvitesContext';
import { AppShell } from '@/components/AppShell';
import { patchConsoleIntoDebugLog } from '@/lib/debugLog';
patchConsoleIntoDebugLog();
import NotFound from '@/pages/not-found';
import AuthPage from '@/pages/AuthPage';
import OnboardingPage from '@/pages/OnboardingPage';
import DiscoverPage from '@/pages/DiscoverPage';
import SearchPage from '@/pages/SearchPage';
import InvitesPage from '@/pages/InvitesPage';
import MatchesPage from '@/pages/MatchesPage';
import MatchDetailPage from '@/pages/MatchDetailPage';
import ChatPage from '@/pages/ChatPage';
import ProfilePage from '@/pages/ProfilePage';
import PreferencesPage from '@/pages/PreferencesPage';
import NotificationsPage from '@/pages/NotificationsPage';
import WhoViewedMePage from '@/pages/WhoViewedMePage';
import SettingsPage from '@/pages/SettingsPage';
import BlockContactsPage from '@/pages/BlockContactsPage';
import AdminPage from '@/pages/AdminPage';
import ResetPasswordPage from '@/pages/ResetPasswordPage';
import AuthCallbackPage from '@/pages/AuthCallbackPage';
import PayfastReturnPage from '@/pages/PayfastReturnPage';
import PayfastCancelPage from '@/pages/PayfastCancelPage';
import VerificationPayfastReturnPage from '@/pages/VerificationPayfastReturnPage';
import VerificationPayfastCancelPage from '@/pages/VerificationPayfastCancelPage';
const queryClient = new QueryClient();
function ProtectedRoute({ component: Component, skipOnboardingCheck, ...rest }: any) {
  const { isAuthenticated, onboardingCompleted, checkOnboardingStatus } = useAuth();
  const [location] = useLocation();
  // Tracks whether THIS mount's own check has resolved — not whether
  // onboardingCompleted has ever been checked at all. Real bug found in
  // production: right after finishing onboarding, onboardingCompleted
  // was still the OLD cached `false` from before completion (the fresh
  // re-check below is async and hadn't resolved yet), and the old
  // version of this component redirected on that stale value
  // immediately — bouncing someone back to "Get Started" the instant
  // after they finished onboarding, even though the save had already
  // succeeded. Initializing this to true only when onboardingCompleted
  // is ALREADY known-true means a stale `false` is never trusted on its
  // own; the component waits for this navigation's own fresh check
  // before deciding anything.
  const [hasConfirmedThisNav, setHasConfirmedThisNav] = useState(onboardingCompleted === true);

  useEffect(() => {
    let cancelled = false;
    if (isAuthenticated && onboardingCompleted !== true) {
      setHasConfirmedThisNav(false);
      checkOnboardingStatus().then(() => {
        if (!cancelled) setHasConfirmedThisNav(true);
      });
    } else {
      setHasConfirmedThisNav(true);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, location]);

  // Re-verifies on every navigation to a guarded route, but ONLY while
  // onboardingCompleted isn't already known-true — once true, it can
  // never legitimately become false again for the same account, so
  // there's no reason to keep re-checking an already-onboarded user on
  // every single navigation. This is also what closes the back-button
  // bypass: pressing back still mounts this component fresh for
  // whatever route it lands on, which re-runs this effect and
  // re-confirms the real state instead of trusting whatever was
  // rendered before the user navigated away.

  if (!isAuthenticated) {
    return <Redirect to="/" />;
  }

  if (!skipOnboardingCheck) {
    if (!hasConfirmedThisNav || onboardingCompleted === null) {
      // Still verifying (or the check hasn't run yet) — deliberately
      // does NOT render Component here, even briefly. Rendering the
      // real page first and redirecting a moment later is exactly the
      // kind of flash-then-redirect that made the back-button bypass
      // possible in the first place.
      return (
        <div className="flex items-center justify-center h-[100dvh] w-full">
          <Loader2 className="animate-spin text-primary" size={28} />
        </div>
      );
    }
    if (onboardingCompleted === false) {
      return <Redirect to="/onboarding" />;
    }
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

// Stable, module-level wrapper components — one per route — instead of
// inline arrow functions in the JSX below. This matters far more than
// it looks: Router is nested inside AuthProvider/SparksProvider/
// InvitesProvider, none of which are memoized, so by default ANY state
// change in ANY of them (a token refresh, a Sparks balance poll, an
// invites-count poll — all of which happen every 30-60s) re-renders
// every descendant, including Router. An inline `component={() => (...)}`
// is a BRAND NEW function reference on every one of those re-renders,
// and React treats a changed component reference as a different
// component type — meaning the currently-active page was being fully
// unmounted and remounted (not just re-rendered) on essentially every
// background poll, app-wide. That's what was actually behind the
// Discover card "blinking" (its whole parent page was being torn down
// and rebuilt), and very likely a major contributor to the excessive
// duplicate API call volume seen throughout this session — every
// remount re-ran every one of that page's mount-time fetches from
// scratch. Defining these once, outside the render function, gives them
// a referentially stable identity forever, so ordinary re-renders no
// longer cause a remount.
const PublicAuthRoute = () => <PublicRoute component={AuthPage} />;
const ProtectedOnboardingRoute = () => <ProtectedRoute component={OnboardingPage} skipOnboardingCheck />;
const ProtectedDiscoverRoute = () => <ProtectedRoute component={DiscoverPage} />;
const ProtectedSearchRoute = () => <ProtectedRoute component={SearchPage} />;
const ProtectedInvitesRoute = () => <ProtectedRoute component={InvitesPage} />;
const ProtectedMatchesRoute = () => <ProtectedRoute component={MatchesPage} />;
const ProtectedMatchDetailRoute = () => <ProtectedRoute component={MatchDetailPage} />;
const ProtectedChatRoute = () => <ProtectedRoute component={ChatPage} />;
const ProtectedProfileRoute = () => <ProtectedRoute component={ProfilePage} />;
const ProtectedPreferencesRoute = () => <ProtectedRoute component={PreferencesPage} />;
const ProtectedNotificationsRoute = () => <ProtectedRoute component={NotificationsPage} />;
const ProtectedWhoViewedMeRoute = () => <ProtectedRoute component={WhoViewedMePage} />;
const ProtectedPayfastReturnRoute = () => <ProtectedRoute component={PayfastReturnPage} />;
const ProtectedPayfastCancelRoute = () => <ProtectedRoute component={PayfastCancelPage} />;
const ProtectedVerificationPayfastReturnRoute = () => <ProtectedRoute component={VerificationPayfastReturnPage} />;
const ProtectedVerificationPayfastCancelRoute = () => <ProtectedRoute component={VerificationPayfastCancelPage} />;
const ProtectedSettingsRoute = () => <ProtectedRoute component={SettingsPage} />;
const ProtectedBlockContactsRoute = () => <ProtectedRoute component={BlockContactsPage} />;
const ProtectedAdminRoute = () => <ProtectedRoute component={AdminPage} />;

function Router() {
  return (
    <AppShell>
      <Switch>
        {/* Public Routes */}
        <Route path="/" component={PublicAuthRoute} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/auth/callback" component={AuthCallbackPage} />
        
        {/* Protected Routes */}
        <Route path="/onboarding" component={ProtectedOnboardingRoute} />
        <Route path="/discover" component={ProtectedDiscoverRoute} />
        <Route path="/search" component={ProtectedSearchRoute} />
        <Route path="/invites" component={ProtectedInvitesRoute} />
        <Route path="/matches" component={ProtectedMatchesRoute} />
        <Route path="/matches/:matchId" component={ProtectedMatchDetailRoute} />
        <Route path="/matches/:matchId/chat" component={ProtectedChatRoute} />
        <Route path="/profile" component={ProtectedProfileRoute} />
        <Route path="/preferences" component={ProtectedPreferencesRoute} />
        <Route path="/notifications" component={ProtectedNotificationsRoute} />
        <Route path="/who-viewed-me" component={ProtectedWhoViewedMeRoute} />
        <Route path="/sparks/payfast/return" component={ProtectedPayfastReturnRoute} />
        <Route path="/sparks/payfast/cancel" component={ProtectedPayfastCancelRoute} />
        <Route path="/verification/payfast/return" component={ProtectedVerificationPayfastReturnRoute} />
        <Route path="/verification/payfast/cancel" component={ProtectedVerificationPayfastCancelRoute} />
        <Route path="/settings" component={ProtectedSettingsRoute} />
        <Route path="/block-contacts" component={ProtectedBlockContactsRoute} />
        <Route path="/admin" component={ProtectedAdminRoute} />
        
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
              <InvitesProvider>
                <Router />
              </InvitesProvider>
            </SparksProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
export default App;
