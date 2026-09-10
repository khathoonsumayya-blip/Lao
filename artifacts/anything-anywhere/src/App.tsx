import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  BookPage,
  DeliveryDetailPage,
  HomePage,
  OrdersPage,
  ProfilePage,
  AriPage,
  SupportPage,
  WalletPage,
} from '@/pages/customer-pages';
import { ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage, VerifyEmailPage, VerifyPhonePage, WelcomePage } from '@/pages/auth-pages';
import { useDeliveryEvents } from '@/hooks/use-delivery-events';
import { apiUrl, configuredApiOrigin } from '@/lib/api-url';
import { customerSignInLocation } from '@/customer-entry-routing';
import { setBaseUrl } from '@workspace/api-client-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
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

setBaseUrl(configuredApiOrigin || null);

function DeliverySynchronization() {
  const session = useCustomerSession();
  useDeliveryEvents(Boolean(session.data?.profile));
  return null;
}

function useCustomerSession() {
  return useQuery({
    queryKey: ['customer-auth-session'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/auth/session?noDemo=true'), { credentials: 'include' });
      if (!response.ok) throw new Error('Sign in is required for this request.');
      return response.json() as Promise<{ profile?: { role?: string } }>;
    },
    retry: false,
    retryOnMount: false,
    refetchInterval: (query) => query.state.status === 'success' && query.state.data?.profile?.role === 'customer' ? 20_000 : false,
    refetchOnWindowFocus: (query) => query.state.status === 'success' && query.state.data?.profile?.role === 'customer',
    refetchOnReconnect: (query) => query.state.status === 'success' && query.state.data?.profile?.role === 'customer',
  });
}

function CustomerGate({ children }: { children: ReactNode }) {
  const [, setLocation] = useLocation();
  const session = useCustomerSession();
  const needsCustomerSignIn = !session.isLoading && (
    session.isError || session.data?.profile?.role !== 'customer'
  );
  useEffect(() => {
    if (needsCustomerSignIn) {
      setLocation(customerSignInLocation(window.location.search), { replace: true });
    }
  }, [needsCustomerSignIn, setLocation]);
  if (session.isLoading) return <main className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] text-sm text-[hsl(var(--muted-foreground))]">Checking your secure session…</main>;
  if (needsCustomerSignIn) return null;
  return <>{children}</>;
}

function CustomerEntry() {
  const [, setLocation] = useLocation();
  const session = useCustomerSession();
  const needsCustomerSignIn = !session.isLoading && session.data?.profile?.role !== 'customer';
  useEffect(() => {
    if (needsCustomerSignIn) {
      setLocation(customerSignInLocation(window.location.search), { replace: true });
    }
  }, [needsCustomerSignIn, setLocation]);
  if (session.isLoading) return <main className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))] text-sm text-[hsl(var(--muted-foreground))]">Checking your secure session…</main>;
  if (needsCustomerSignIn) return null;
  return <HomePage />;
}

function ProtectedBook() { return <CustomerGate><BookPage /></CustomerGate>; }
function ProtectedOrders() { return <CustomerGate><OrdersPage /></CustomerGate>; }
function ProtectedDelivery() { return <CustomerGate><DeliveryDetailPage /></CustomerGate>; }
function ProtectedWallet() { return <CustomerGate><WalletPage /></CustomerGate>; }
function ProtectedProfile() { return <CustomerGate><ProfilePage /></CustomerGate>; }
function ProtectedSupport() { return <CustomerGate><SupportPage /></CustomerGate>; }

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={CustomerEntry} />
        <Route path="/customer" component={CustomerEntry} />
        <Route path="/welcome" component={WelcomePage} />
        <Route path="/sign-up" component={SignUpPage} />
        <Route path="/sign-in" component={SignInPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/verify-phone" component={VerifyPhonePage} />
        <Route path="/book" component={ProtectedBook} />
        <Route path="/orders" component={ProtectedOrders} />
        <Route path="/orders/:id" component={ProtectedDelivery} />
        <Route path="/wallet" component={ProtectedWallet} />
        <Route path="/profile" component={ProtectedProfile} />
        <Route path="/support" component={ProtectedSupport} />
        <Route path="/ari" component={AriPage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DeliverySynchronization />
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
