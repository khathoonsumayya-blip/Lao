import { Link } from 'wouter';
import { Package, Car, LayoutDashboard, ArrowRight } from 'lucide-react';

export function LauncherPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-[hsl(var(--background))] p-6 text-[hsl(var(--foreground))]">
      <div className="w-full max-w-4xl">
        <div className="mb-12 text-center">
          <img src={`${import.meta.env.BASE_URL}lao-brand-mark.svg`} alt="" className="mx-auto mb-4 size-20 object-contain drop-shadow-lg" />
          <h1 className="font-display text-4xl font-extrabold tracking-[-.06em] text-[hsl(var(--primary))] sm:text-5xl">Lao</h1>
          <p className="mt-4 text-lg text-[hsl(var(--muted-foreground))]">Select an environment to continue.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Link href="/customer" className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl">
            <div>
              <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-600 group-hover:bg-orange-500 group-hover:text-white transition-colors">
                <Package className="size-6" />
              </div>
              <h2 className="font-display text-2xl font-bold">Customer App</h2>
              <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Book deliveries, track orders, manage your wallet, and chat with Ari.</p>
            </div>
            <div className="mt-8 flex items-center font-bold text-orange-600">
              Open App <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>

          {/* Driver App is a separate artifact, use a regular anchor tag */}
          <a href="/driver/" className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl" data-testid="link-launcher-driver">
            <div>
              <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                <Car className="size-6" />
              </div>
              <h2 className="font-display text-2xl font-bold">Driver App</h2>
              <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Accept dispatch requests, navigate routes, and manage payouts.</p>
            </div>
            <div className="mt-8 flex items-center font-bold text-emerald-600">
              Open App <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
            </div>
          </a>

          <Link href="/admin" className="group relative flex flex-col justify-between overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-sm transition-all hover:-translate-y-1 hover:shadow-xl" data-testid="link-launcher-admin">
            <div>
              <div className="mb-6 flex size-12 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-600 group-hover:bg-cyan-500 group-hover:text-white transition-colors">
                <LayoutDashboard className="size-6" />
              </div>
              <h2 className="font-display text-2xl font-bold">Admin Desk</h2>
              <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Manage operations, monitor live dispatch, and configure platform settings.</p>
            </div>
            <div className="mt-8 flex items-center font-bold text-cyan-600">
              Open Desk <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
