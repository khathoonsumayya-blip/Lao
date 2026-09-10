import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, CircleHelp, Clock3, Home, Package, UserRound } from 'lucide-react';
import { getGetDeliveryQueryKey, useGetDelivery } from '@workspace/api-client-react';
import { formatCustomerPickupSchedule } from '@/lib/pickup-schedule';

const navItems = [
  { href: '/customer', label: 'Home', icon: Home },
  { href: '/orders', label: 'Deliveries', icon: Package },
  { href: '/support', label: 'Support', icon: CircleHelp },
  { href: '/profile', label: 'Account', icon: UserRound },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/customer" aria-label="Lao customer home" className="group inline-flex items-center gap-3" data-testid="link-logo">
      <img className="aa-logo-mark" src={`${import.meta.env.BASE_URL}lao-brand-mark.svg`} alt="" aria-hidden="true" />
      {!compact && <span className="aa-wordmark"><strong>Lao</strong><span>On-demand delivery</span></span>}
    </Link>
  );
}

function AriMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M14 22.5c0-7 4.2-11.5 10-11.5s10 4.5 10 11.5v7.5H14v-7.5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M15 18 9 14m24 4 6-4M18 30v4m12-4v4M18 37h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 29h26v8H11z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M18 24h.01M30 24h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M22 28c1.5 1 2.5 1 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const detailMatch = location.match(/^\/orders\/([^/?#]+)$/);
  const detailId = detailMatch?.[1] ?? '';
  const detail = useGetDelivery(detailId, {
    query: {
      enabled: Boolean(detailId),
      queryKey: getGetDeliveryQueryKey(detailId),
    },
  });
  const pickupWindow = formatCustomerPickupSchedule(
    detail.data?.scheduledPickupStartAt,
    detail.data?.scheduledPickupEndAt,
  );
  const active = (href: string) => href === '/customer' ? location === '/customer' : location.startsWith(href);
  const showAri = !['/ari', '/book'].includes(location);
  return (
    <div className="aa-shell min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="aa-header sticky top-0 z-40 backdrop-blur-xl">
        <div className="aa-header-inner mx-auto flex h-[76px] items-center justify-between px-5 lg:px-8">
          <Logo />
          <div className="hidden items-center gap-8 md:flex">
            <span className="aa-loc">Local delivery, simply.</span>
            <div className="flex items-center gap-6">
              {navItems.map(({ href, label }) => (
                <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined} className="aa-desktop-link transition-colors" data-testid={`link-desktop-${label.toLowerCase()}`}>{label}</Link>
              ))}
            </div>
            <Link href="/profile" aria-label="Open your profile" className="grid size-10 place-items-center rounded-xl bg-[hsl(var(--primary))] font-mono text-xs font-bold text-[hsl(var(--primary-foreground))] transition-transform hover:rotate-2" data-testid="link-profile-avatar">ML</Link>
          </div>
          <Link href="/book" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[hsl(var(--accent))] px-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--accent-foreground))] shadow-lift transition-transform hover:-translate-y-0.5 md:hidden" data-testid="link-book-header">
            Book delivery <ArrowRight className="size-4" />
          </Link>
        </div>
      </header>
      <main className="aa-main mx-auto px-5 pb-28 pt-8 lg:px-8 lg:pb-12">
        {detailId && detail.data && <div className="mb-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] p-4" data-testid="scheduled-pickup-detail"><p className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Pickup timing</p><p className="mt-1 text-sm font-semibold text-[hsl(var(--primary))]">{pickupWindow ? `Scheduled pickup: ${pickupWindow}` : 'As soon as possible'}</p></div>}
        {children}
      </main>
      {showAri && <Link href="/ari" className="aa-fab" aria-label="Ask Ari for delivery help" data-testid="button-ask-ari">
        <span className="sr-only">Ask Ari</span><AriMark />
      </Link>}
      <nav aria-label="Customer navigation" className="aa-bottom-nav fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined} className={`flex min-w-[52px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 transition-colors ${active(href) ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid={`link-nav-${label.toLowerCase()}`}>
              <Icon className="size-[19px]" strokeWidth={active(href) ? 2.5 : 1.8} /><span>{label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div>
      {eyebrow && <p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">{eyebrow}</p>}
      <h1 className="font-display text-3xl font-extrabold tracking-[-.055em] text-[hsl(var(--primary))] sm:text-4xl">{title}</h1>
      {description && <p className="mt-2 max-w-xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{description}</p>}
    </div>
    {action}
  </div>;
}

export function LoadingState({ label = 'Getting things ready' }: { label?: string }) {
  return <div className="space-y-4" aria-busy="true" role="status"><div className="h-32 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" /><div className="grid gap-4 sm:grid-cols-2"><div className="h-24 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" /><div className="h-24 animate-pulse rounded-2xl bg-[hsl(var(--muted))]" /></div><p className="text-center text-sm text-[hsl(var(--muted-foreground))]">{label}…</p></div>;
}

export function ErrorState({ onRetry, title = 'We hit a small snag' }: { onRetry?: () => void; title?: string }) {
  return <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center shadow-soft" role="alert"><div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Clock3 className="size-5" /></div><h2 className="font-display text-xl font-bold text-[hsl(var(--primary))]">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[hsl(var(--muted-foreground))]">Our delivery team is still reachable. Try again, or contact support and we’ll help sort it out.</p>{onRetry && <button onClick={onRetry} className="mt-5 min-h-11 rounded-full bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5" data-testid="button-retry">Try again</button>}</div>;
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-10 text-center"><div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Package className="size-5" /></div><h2 className="font-display text-xl font-bold text-[hsl(var(--primary))]">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[hsl(var(--muted-foreground))]">{message}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

export function PrimaryButton({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-full bg-[hsl(var(--accent))] px-5 py-3 text-sm font-bold text-[hsl(var(--accent-foreground))] shadow-lift transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>;
}
