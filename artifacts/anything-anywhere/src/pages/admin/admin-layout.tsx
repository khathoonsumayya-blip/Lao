import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { 
  BarChart3, 
  Box, 
  Car, 
  Settings, 
  Users, 
  LifeBuoy,
  CreditCard,
  LogOut,
  Menu,
  X,
  Bell
} from 'lucide-react';
import { getGetAdminDashboardQueryKey, useGetAdminDashboard } from '@workspace/api-client-react';
import { AdminLogin } from './admin-login';
import '@/admin.css';
import { apiUrl } from '@/lib/api-url';

const navItems = [
  { href: '/', label: 'Dashboard', icon: BarChart3 },
  { href: '/deliveries', label: 'Deliveries', icon: Box },
  { href: '/drivers', label: 'Drivers', icon: Car },
  { href: '/customers', label: 'Customers', icon: Users },
  { href: '/payments', label: 'Payments', icon: CreditCard },
  { href: '/support', label: 'Support', icon: LifeBuoy },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const queryClient = useQueryClient();

  const { error, isLoading, refetch } = useGetAdminDashboard({
    query: { retry: false, queryKey: getGetAdminDashboardQueryKey() },
  });

  const isAuthenticated = !error;
  const status = (error as { status?: number } | undefined)?.status;
  const isUnauthorized = status === 401 || status === 403;

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isMobileMenuOpen]);

  if (isLoading) {
    return (
      <div className="aa-admin-theme flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-4 border-[hsl(var(--primary))] border-t-transparent" role="status" aria-label="Loading operations desk"></div>
      </div>
    );
  }

  if (isUnauthorized) {
    return <AdminLogin onSuccess={() => refetch()} />;
  }

  if (error && !isUnauthorized) {
    return (
      <div className="aa-admin-theme flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
            <X className="size-6" />
          </div>
          <h2 className="text-xl font-bold text-[hsl(var(--foreground))]">Error loading desk</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{(error as Error).message || 'An unexpected error occurred.'}</p>
          <button 
            onClick={() => refetch()}
            className="min-h-11 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-[hsl(var(--primary-foreground))]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      await fetch(apiUrl('/api/auth/sign-out'), { method: 'POST', credentials: 'include' });
      queryClient.clear();
      setLocation('/');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="aa-admin-theme flex min-h-screen flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="flex h-16 items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 md:hidden">
        <div className="flex items-center gap-2 font-bold tracking-tight text-[hsl(var(--foreground))]">
          <Box className="size-5 text-[hsl(var(--primary))]" /> Desk
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          aria-expanded={isMobileMenuOpen}
          aria-controls="admin-mobile-menu"
          aria-label={isMobileMenuOpen ? 'Close operations navigation' : 'Open operations navigation'}
          className="rounded-md p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]"
        >
          {isMobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Sidebar */}
      <aside id="admin-mobile-menu" aria-label="Operations navigation" className={`aa-admin-sidebar fixed inset-y-0 z-50 flex w-64 flex-col transition-transform md:static md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-16 items-center gap-2 border-b border-[hsl(var(--border))] px-6 font-bold tracking-tight text-[hsl(var(--foreground))]">
          <Box className="size-5 text-[hsl(var(--primary))]" /> 
          <span className="aa-admin-font-sans">Operations Desk</span>
        </div>
        
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {navItems.map((item) => {
            const active = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className="aa-admin-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm"
                aria-current={active ? 'page' : undefined}
                data-testid={`link-admin-${item.label.toLowerCase()}`}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[hsl(var(--border))] p-4">
          <button 
            onClick={handleLogout}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--destructive))]/10 hover:text-[hsl(var(--destructive))]"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[hsl(var(--background))]">
        {/* Desktop Topbar */}
        <header className="hidden h-16 shrink-0 items-center justify-end border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-8 md:flex">
          <button aria-label="View operations notifications" className="relative rounded-full p-2 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] transition-colors" data-testid="button-admin-notifications">
            <Bell className="size-5" />
            <span className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-[hsl(var(--primary))] ring-2 ring-[hsl(var(--card))]"></span>
          </button>
        </header>
        
        <div className="flex-1 overflow-y-auto p-4 pb-[max(2rem,calc(1.5rem+env(safe-area-inset-bottom)))] md:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </main>
      
      {/* Mobile overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
