import { useGetAdminDashboard, useListAdminAuditLogs, useListAdminDeliveries } from '@workspace/api-client-react';
import { Package, Car, CheckCircle2, XCircle, DollarSign, Clock, BellRing, Route } from 'lucide-react';
import { AdminLayout } from './admin-layout';

export function AdminDashboard() {
  const { data, isLoading, error } = useGetAdminDashboard();
  const { data: deliveries = [] } = useListAdminDeliveries();
  const { data: auditEvents = [] } = useListAdminAuditLogs();

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-6">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-[hsl(var(--muted))]"></div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-[hsl(var(--card))]"></div>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  if (!data) {
    return <AdminLayout><div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-sm text-[hsl(var(--muted-foreground))]">The desk summary is unavailable. {(error as Error | undefined)?.message ?? 'Try refreshing the page.'}</div></AdminLayout>;
  }

  const stats = [
    { label: 'Orders Today', value: data.deliveriesToday, icon: Package, color: 'text-violet-500', bg: 'bg-violet-500/10' },
    { label: 'Active Deliveries', value: data.activeDeliveries, icon: Package, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'Drivers Online', value: data.driversOnline, icon: Car, color: 'text-green-500', bg: 'bg-green-500/10' },
    { label: 'Completed Today', value: data.completedToday, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Searching Driver', value: data.searchingForDriver, icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
    { label: 'Cancelled', value: data.cancelledToday, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
    { label: 'Today\'s Revenue', value: data.revenue === undefined ? 'Restricted' : `$${data.revenue.toFixed(2)}`, icon: DollarSign, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Overview</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Real-time pulse of Raleigh operations.</p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((stat, i) => (
            <div key={i} className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{stat.label}</p>
                  <p className="mt-2 text-3xl font-extrabold text-[hsl(var(--foreground))]" data-testid={`stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                    {stat.value}
                  </p>
                </div>
                <div className={`flex size-12 items-center justify-center rounded-xl ${stat.bg} ${stat.color}`}>
                  <stat.icon className="size-6" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Live delivery queue</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Status and assignment signals from the shared dispatch system.</p></div>
              <Route className="size-5 text-[hsl(var(--primary))]" />
            </div>
            <div className="space-y-3">
              {deliveries.slice(0, 4).map((delivery) => <div key={delivery.id} className="flex items-center justify-between gap-4 rounded-xl bg-[hsl(var(--muted))]/50 px-4 py-3"><div className="min-w-0"><p className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{delivery.orderNumber}</p><p className="mt-1 truncate text-sm text-[hsl(var(--muted-foreground))]">{delivery.pickupAddress} → {delivery.dropoffAddress}</p></div><div className="shrink-0 text-right"><span className="rounded-full bg-[hsl(var(--card))] px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{delivery.status.replaceAll('_', ' ')}</span><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{delivery.driverName ?? 'Unassigned'}</p></div></div>)}
              {!deliveries.length && <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-sm text-[hsl(var(--muted-foreground))]">No live deliveries need attention right now.</p>}
            </div>
          </section>
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2"><BellRing className="size-4 text-[hsl(var(--primary))]" /><h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Notifications</h2></div>
            <div className="space-y-3">
              {auditEvents.slice(0, 4).map((event) => <div key={event.id} className="border-l-2 border-[hsl(var(--primary))] pl-3"><p className="text-sm font-semibold text-[hsl(var(--foreground))]">{event.action.replaceAll('_', ' ')}</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{event.entityLabel ?? event.entityType} · {new Date(event.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p></div>)}
              {!auditEvents.length && <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">New operational alerts and staff actions will appear here.</p>}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-[hsl(var(--foreground))]">Recent Activity Trend</h2>
          <div className="flex h-64 items-end gap-2">
            {/* Fake chart for now since trend might be empty or complex */}
            {(data.trend && data.trend.length > 0) ? (
              data.trend.map((point: any, i: number) => {
                const height = Math.max(10, Math.min(100, (point.count || 0) * 10));
                return (
                  <div key={i} className="group relative flex flex-1 flex-col justify-end">
                    <div 
                      className="w-full rounded-t-sm bg-[hsl(var(--primary))]/80 transition-all group-hover:bg-[hsl(var(--primary))]" 
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Not enough data to display trend.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </AdminLayout>
  );
}
