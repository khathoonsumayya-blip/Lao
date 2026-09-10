import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BarChart3, Bell, Box, Car, CreditCard, LifeBuoy, LogOut, Menu, Settings, Users, X, Award } from 'lucide-react';
import { apiUrl } from '@/lib/api-url';
import '@/admin.css';

const navItems = [
  ['/', 'Dashboard', BarChart3], ['/deliveries', 'Deliveries', Box], ['/drivers', 'Drivers', Car],
  ['/customers', 'Customers', Users], ['/payments', 'Payments', CreditCard], ['/rewards', 'Rewards', Award],
  ['/support', 'Support', LifeBuoy], ['/settings', 'Settings', Settings],
] as const;

export function AdminLayout({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => { setMenuOpen(false); }, [location]);
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      const response = await fetch(apiUrl('/api/auth/signout'), { method: 'POST', credentials: 'include' });
      if (!response.ok) throw new Error('The server could not end your session.');
      queryClient.clear();
      window.location.replace(import.meta.env.BASE_URL || '/admin/');
    } catch (error) {
      setLoggingOut(false);
      setLogoutError(error instanceof Error ? error.message : 'Unable to log out securely.');
    }
  };

  if (loggingOut) return <div className="aa-admin-theme grid min-h-screen place-items-center">Signing you out securely…</div>;

  return <div className="aa-admin-theme flex min-h-screen bg-[hsl(var(--background))]">
    <aside className={`aa-admin-sidebar fixed inset-y-0 z-50 flex w-64 flex-col ${menuOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform lg:static lg:translate-x-0`}>
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b px-5">
        <img src={`${import.meta.env.BASE_URL}lao-brand-mark.svg`} alt="" className="size-10 object-contain" />
        <span className="text-xl font-extrabold tracking-[-.045em]">Lao</span>
        <span className="text-[10px] font-bold uppercase tracking-[.14em] text-[#ff4a00]">Admin</span>
      </div>
      <nav className="flex-1 overflow-y-auto space-y-1 p-4" aria-label="Operations navigation">
        {navItems.map(([href, label, Icon]) => <Link key={href} href={href} aria-current={location === href ? 'page' : undefined} className="aa-admin-nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm" data-testid={`link-admin-${label.toLowerCase()}`}><Icon className="size-4" />{label}</Link>)}
      </nav>
      <div className="shrink-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
         {logoutError && <p role="alert" className="mb-2 text-xs text-red-600">{logoutError}</p>}
         <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-[hsl(var(--muted))]"><LogOut className="size-4" />Log out</button>
      </div>
    </aside>
    {menuOpen && <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-black/50 lg:hidden" />}
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 items-center justify-between border-b bg-[hsl(var(--card))] px-4 lg:justify-end"><button onClick={() => setMenuOpen(true)} className="lg:hidden"><Menu /></button><Bell className="size-5 text-[hsl(var(--muted-foreground))]" /></header>
      <div className="flex-1 overflow-y-auto p-4 md:p-8"><div className="mx-auto max-w-6xl">{children}</div></div>
    </main>
  </div>;
}