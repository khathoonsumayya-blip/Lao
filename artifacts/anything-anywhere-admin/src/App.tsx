import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { AdminDashboard } from '@/pages/admin/admin-dashboard';
import { AdminDeliveries } from '@/pages/admin/admin-deliveries';
import { AdminDrivers } from '@/pages/admin/admin-drivers';
import { AdminCustomers } from '@/pages/admin/admin-customers';
import { AdminSupport } from '@/pages/admin/admin-support';
import { AdminPayments } from '@/pages/admin/admin-payments';
import { AdminRewards } from '@/pages/admin/admin-rewards';
import { AdminSettings } from '@/pages/admin/admin-settings';
import { AdminLogin } from '@/pages/admin/admin-login';
import { AdminForgotPasswordPage, AdminResetPasswordPage } from '@/pages/admin/admin-password-reset';
import { useDeliveryEvents } from '@/hooks/use-delivery-events';
import { apiUrl } from '@/lib/api-url';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';
import './api-config';

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

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AdminDashboard} />
        <Route path="/deliveries" component={AdminDeliveries} />
        <Route path="/drivers" component={AdminDrivers} />
        <Route path="/customers" component={AdminCustomers} />
        <Route path="/support" component={AdminSupport} />
        <Route path="/payments" component={AdminPayments} />
        <Route path="/rewards" component={AdminRewards} />
        <Route path="/settings" component={AdminSettings} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function AdminRouter() {
  return (
    <Switch>
      <Route path="/forgot-password" component={AdminForgotPasswordPage} />
      <Route path="/reset-password" component={AdminResetPasswordPage} />
      <Route>
        <AdminAccessGate />
      </Route>
    </Switch>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

type AdminSession = {
  profile?: {
    role?: string;
  };
};

const adminRoles = new Set(['admin', 'dispatcher', 'support']);

class AdminSessionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function useAdminSession(publicLoginMounted: boolean) {
  return useQuery<AdminSession, AdminSessionError>({
    queryKey: ['admin-auth-session'],
    queryFn: async () => {
      const response = await fetch(apiUrl('/api/auth/session?admin=true'), {
        credentials: 'include',
        cache: 'no-store',
      });
      const body = await response.json().catch(() => ({})) as { error?: string; profile?: AdminSession['profile'] };
      if (!response.ok) {
        throw new AdminSessionError(body.error || 'Sign in is required for this request.', response.status);
      }
      return body;
    },
    enabled: !publicLoginMounted,
    retry: false,
    staleTime: 0,
    refetchOnMount: false,
    retryOnMount: false,
    refetchInterval: (query) => query.state.status === 'success' && adminRoles.has(query.state.data?.profile?.role ?? '') ? 20_000 : false,
    refetchOnWindowFocus: (query) => query.state.status === 'success' && adminRoles.has(query.state.data?.profile?.role ?? ''),
    refetchOnReconnect: (query) => query.state.status === 'success' && adminRoles.has(query.state.data?.profile?.role ?? ''),
  });
}

const permissionMessage = "You don’t have permission to access the Admin App.";

function PermissionDenied() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const switchAccount = async () => {
    setPending(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/auth/signout'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('The server could not end your current session.');
      queryClient.clear();
      window.location.replace(import.meta.env.BASE_URL || '/admin/');
    } catch (reason) {
      setPending(false);
      setError(reason instanceof Error ? reason.message : 'Unable to switch accounts securely.');
    }
  };

  return (
    <main className="aa-admin-theme grid min-h-screen place-items-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-extrabold">Access denied</h1>
        <p role="alert" className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{permissionMessage}</p>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
          A Customer or Driver session is currently active. Sign out before using an authorized staff account.
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={switchAccount}
          disabled={pending}
          className="mt-6 rounded-xl bg-[hsl(var(--primary))] px-4 py-3 font-bold text-white disabled:opacity-60"
        >
          {pending ? 'Signing out…' : 'Sign out and switch account'}
        </button>
      </div>
    </main>
  );
}

function AuthorizedAdminApp() {
  useDeliveryEvents(true);
  return <Router />;
}

function AdminAccessGate() {
  const [publicLoginMounted, setPublicLoginMounted] = useState(false);
  const session = useAdminSession(publicLoginMounted);
  const unauthorized = session.isError && session.error.status === 401;

  useEffect(() => {
    if (unauthorized) setPublicLoginMounted(true);
  }, [unauthorized]);

  const refreshAfterLogin = async () => {
    const refreshed = await session.refetch();
    if (refreshed.isError || !adminRoles.has(refreshed.data?.profile?.role ?? '')) {
      throw new Error('The secure Admin session could not be verified.');
    }
    setPublicLoginMounted(false);
  };

  if (publicLoginMounted || unauthorized) {
    return <AdminLogin onSuccess={refreshAfterLogin} />;
  }
  if (session.isLoading) {
    return <div className="aa-admin-theme grid min-h-screen place-items-center text-sm text-[hsl(var(--muted-foreground))]">Checking your secure session…</div>;
  }
  if (session.isError && session.error.status === 403) {
    return <PermissionDenied />;
  }
  if (session.isError) {
    return (
      <main className="aa-admin-theme grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="font-bold">Unable to verify Admin access</p>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Try again when the server is available.</p>
          <button onClick={() => session.refetch()} className="mt-4 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-white">Retry</button>
        </div>
      </main>
    );
  }
  if (!adminRoles.has(session.data?.profile?.role ?? '')) {
    return <PermissionDenied />;
  }
  return <AuthorizedAdminApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AdminRouter />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
