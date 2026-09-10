import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { DriverAppShell } from '@/components/layout';
import Welcome from '@/pages/welcome';
import Onboarding from '@/pages/onboarding';
import Home from '@/pages/home';
import DeliveryDetail from '@/pages/delivery-detail';
import Earnings from '@/pages/earnings';
import Safety from '@/pages/safety';
import Profile from '@/pages/profile';
import ProfileEdit from '@/pages/profile-edit';
import Settings from '@/pages/settings';
import History from '@/pages/history';
import Notifications from '@/pages/notifications';
import ActiveDelivery from '@/pages/active-delivery';
import Rewards from '@/pages/rewards';
import Support from '@/pages/support';
import { DriverSessionProvider, useDriverSession } from '@/lib/driver-session';
import './api-config';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 8_000,
      refetchInterval: 20_000,
      refetchOnMount: 'always',
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (attempt, error: any) => error?.status !== 401 && error?.status !== 403 && attempt < 2,
      retryDelay: (attempt) => Math.min(10_000, 750 * 2 ** attempt),
    },
    mutations: { retry: false },
  },
});

function Router() {
  return (
    <DriverGate>
      <DriverAppShell>
        <RoutedErrorBoundary>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/home" component={Home} />
            <Route path="/orders" component={Home} />
            <Route path="/available-deliveries" component={Home} />
            <Route path="/deliveries" component={Home} />
            <Route path="/active-delivery" component={ActiveDelivery} />
            <Route path="/welcome" component={Welcome} />
            <Route path="/onboarding" component={Onboarding} />
            <Route path="/delivery/:id" component={DeliveryDetail} />
            <Route path="/deliveries/:deliveryId" component={DeliveryDetail} />
            <Route path="/earnings" component={Earnings} />
            <Route path="/rewards" component={Rewards} />
            <Route path="/history" component={History} />
            <Route path="/notifications" component={Notifications} />
            <Route path="/safety" component={Safety} />
            <Route path="/help" component={Support} />
            <Route path="/support" component={Support} />
            <Route path="/profile" component={Profile} />
            <Route path="/profile/edit" component={ProfileEdit} />
            <Route path="/vehicle" component={ProfileEdit} />
            <Route path="/settings" component={Settings} />
            <Route path="/status" component={Onboarding} />
            <Route component={NotFound} />
          </Switch>
        </RoutedErrorBoundary>
      </DriverAppShell>
    </DriverGate>
  );
}

function DriverGate({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const profileQuery = useDriverSession();
  const isWelcome = location === '/welcome';

  useEffect(() => {
    if (profileQuery.isLoading || profileQuery.data || isWelcome) return;
    const status = (profileQuery.error as { status?: number } | null)?.status;
    if (status === 401 || status === 403) setLocation('/welcome', { replace: true });
  }, [profileQuery.isLoading, profileQuery.data, profileQuery.error, isWelcome, setLocation]);

  useEffect(() => {
    if (!profileQuery.data || isWelcome) return;
    if (profileQuery.data.approvalStatus !== 'approved' && location !== '/onboarding') setLocation('/onboarding', { replace: true });
    if (profileQuery.data.approvalStatus === 'approved' && location === '/onboarding') setLocation('/', { replace: true });
  }, [profileQuery.data, isWelcome, location, setLocation]);

  if (profileQuery.isLoading && !isWelcome) return <div className="min-h-[100dvh] p-6 pt-20 text-center" role="status">Loading driver session…</div>;
  if (profileQuery.isError && !(profileQuery.error as { status?: number }).status) {
    return <div className="min-h-[100dvh] p-6 pt-20 text-center" role="alert">We could not reach the driver service. <button className="underline" onClick={() => profileQuery.refetch()}>Try again</button></div>;
  }
  if (!profileQuery.data && !isWelcome) return null;
  return <>{children}</>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <DriverSessionProvider>
            <Router />
          </DriverSessionProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
