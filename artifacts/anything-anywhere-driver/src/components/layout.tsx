import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  Bell, Car, ChevronRight, CircleHelp, ClipboardCheck, ClipboardList, History,
  House, Loader2, LogOut, Menu, Navigation, Settings, ShieldAlert, User, Wallet,
  X, Star,
} from 'lucide-react';
import {
  getListDriverDeliveriesQueryKey,
  useListDriverDeliveries,
} from '@workspace/api-client-react';
import { useDriverEvents } from '@/hooks/use-driver-events';
import { useDriverSession } from '@/lib/driver-session';

const terminalDeliveryStatuses = ['delivered', 'cancelled', 'failed', 'refunded'];

const menuItems = [
  { href: '/home', icon: House, label: 'Home' },
  { href: '/available-deliveries', icon: ClipboardList, label: 'Available Deliveries' },
  { href: '/active-delivery', icon: Navigation, label: 'Active Delivery' },
  { href: '/history', icon: History, label: 'Delivery History' },
  { href: '/earnings', icon: Wallet, label: 'Earnings' },
  { href: '/rewards', icon: Star, label: 'Rewards & Bonuses' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
  { href: '/profile', icon: User, label: 'Profile' },
  { href: '/vehicle', icon: Car, label: 'Vehicle & Documents' },
  { href: '/status', icon: ClipboardCheck, label: 'Onboarding Status' },
  { href: '/settings', icon: Settings, label: 'Settings' },
  { href: '/help', icon: CircleHelp, label: 'Help & Support' },
  { href: '/safety', icon: ShieldAlert, label: 'Safety & Issue Reports' },
] as const;

function routeIsActive(location: string, href: string) {
  if (href === '/home') return location === '/' || location === '/home';
  if (href === '/available-deliveries') return location === '/orders' || location === href;
  if (href === '/active-delivery') return location === href || location === '/deliveries' || location.startsWith('/delivery/') || location.startsWith('/deliveries/');
  if (href === '/profile') return location === href;
  if (href === '/vehicle') return location === href || location === '/profile/edit';
  if (href === '/help') return location === href || location === '/support';
  return location === href;
}

/**
 * Persistent authenticated workspace navigation. The menu remains available
 * while a delivery is active, so operational pages never trap the driver.
 */
export function DriverAppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: profile, isLoading, signOut } = useDriverSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const { data: deliveries = [] } = useListDriverDeliveries({
    query: {
      queryKey: getListDriverDeliveriesQueryKey(),
      enabled: Boolean(profile),
      refetchInterval: profile ? 15_000 : false,
    },
  });

  useDriverEvents(Boolean(profile));
  useEffect(() => setMenuOpen(false), [location]);

  const activeDelivery = deliveries.find((delivery) => !terminalDeliveryStatuses.includes(delivery.status));
  const hideNav = location === '/welcome' || location === '/onboarding';
  const bottomItems = [
    { href: '/home', icon: House, label: 'Home' },
    { href: '/available-deliveries', icon: ClipboardList, label: 'Available' },
    { href: activeDelivery ? `/deliveries/${activeDelivery.id}` : '/active-delivery', icon: Navigation, label: 'Active' },
    { href: '/earnings', icon: Wallet, label: 'Earnings' },
  ] as const;

  const logout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await signOut();
      setLocation('/welcome', { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'We could not sign you out.');
      setLoggingOut(false);
    }
  };

  if (isLoading && !hideNav) {
    return (
      <div className="min-h-[100dvh] bg-background px-5 pt-10 text-foreground" role="status" aria-label="Loading driver workspace">
        <div className="mx-auto max-w-lg space-y-5">
          <div className="driver-skeleton h-20 rounded-3xl" />
          <div className="driver-skeleton h-44 rounded-[20px]" />
          <div className="driver-skeleton h-28 rounded-[20px]" />
          <p className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" />Opening your driver workspace</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground overflow-x-hidden">
      {!hideNav && profile && (
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:px-4">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" onClick={() => setMenuOpen(true)} aria-label="Open Driver menu" aria-expanded={menuOpen} aria-controls="driver-menu" className="driver-btn driver-btn-secondary size-11 shrink-0 p-0" data-testid="button-driver-menu">
                <Menu className="size-5" />
              </button>
              <Link href="/home" className="flex min-w-0 items-center gap-2" aria-label="Lao Driver home">
                <img src={`${import.meta.env.BASE_URL}lao-brand-mark.svg`} alt="" className="size-9 shrink-0 object-contain" />
                <span className="truncate font-display text-xl font-extrabold tracking-[-.05em]">Lao</span>
                <span className="hidden font-mono text-[9px] font-bold uppercase tracking-[.16em] text-primary min-[360px]:inline">Driver</span>
              </Link>
            </div>
            <Link href="/notifications" aria-label="Notifications" className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground hover:text-primary transition-colors">
              <Bell className="size-5" />
            </Link>
          </div>
        </header>
      )}

      <main className="relative mx-auto w-full max-w-6xl flex-1 pb-[max(6.5rem,calc(5.75rem+env(safe-area-inset-bottom)))]">
        <div className="mx-auto w-full max-w-lg">{children}</div>
      </main>

      {!hideNav && profile && (
        <nav aria-label="Primary driver navigation" className="driver-bottom-nav fixed bottom-0 left-0 right-0 z-40">
          <div className="max-w-lg mx-auto flex items-center justify-between px-2">
            {bottomItems.map((item) => {
              const Icon = item.icon;
              const isActive = routeIsActive(location, item.label === 'Available' ? '/available-deliveries' : item.label === 'Active' ? '/active-delivery' : item.href);
              return <Link key={item.label} href={item.href} className="flex-1" aria-current={isActive ? 'page' : undefined} data-testid={`nav-${item.label.toLowerCase()}`}>
                <Icon className="mb-1 size-6" strokeWidth={isActive ? 2.5 : 2} />{item.label}
              </Link>;
            })}
            <button type="button" onClick={() => setMenuOpen(true)} className="flex-1" aria-label="Open all Driver sections" data-testid="nav-more">
              <Menu className="mb-1 size-6" />More
            </button>
          </div>
        </nav>
      )}

      {menuOpen && profile && (
        <div className="fixed inset-0 z-[60]" role="presentation">
          <button className="absolute inset-0 bg-black/65 animate-in fade-in duration-300" aria-label="Close Driver menu" onClick={() => setMenuOpen(false)} />
          <aside id="driver-menu" role="dialog" aria-modal="true" aria-labelledby="driver-menu-title" className="absolute inset-y-0 left-0 flex w-[min(90vw,390px)] flex-col border-r border-border bg-card pt-[env(safe-area-inset-top)] shadow-2xl animate-in slide-in-from-left duration-300">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
              <div><h2 id="driver-menu-title" className="font-display text-xl font-bold uppercase">Driver Menu</h2><p className="text-xs text-muted-foreground">{profile.firstName} {profile.lastName}</p></div>
              <button type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu" className="grid size-11 place-items-center rounded-xl border border-border transition-colors hover:bg-secondary"><X className="size-5" /></button>
            </div>
            <nav aria-label="All Driver sections" className="flex-1 overflow-y-auto p-3">
              {menuItems.map(({ href, icon: Icon, label }) => {
                const active = routeIsActive(location, href);
                return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`flex min-h-12 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition-colors ${active ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'}`} data-testid={`menu-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                  <Icon className="size-5 shrink-0" /><span className="flex-1">{label}</span><ChevronRight className="size-4 opacity-60" />
                </Link>;
              })}
            </nav>
            <div className="shrink-0 border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {logoutError && <p className="mb-3 text-sm text-destructive" role="alert">{logoutError}</p>}
              <button type="button" onClick={logout} disabled={loggingOut} className="driver-btn driver-btn-secondary h-12 w-full gap-2" data-testid="button-menu-logout">
                {loggingOut ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}{loggingOut ? 'Signing out…' : 'Log out'}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

export const Layout = DriverAppShell;
