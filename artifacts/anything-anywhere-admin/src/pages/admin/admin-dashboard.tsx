import { useGetAdminDashboard, useListAdminAuditLogs, useListAdminDeliveries } from '@workspace/api-client-react';
import { Package, Car, CheckCircle2, XCircle, DollarSign, Clock, BellRing, Route, RefreshCcw, AlertCircle } from 'lucide-react';
import { AdminLayout } from './admin-layout';
import { formatPickupSchedule } from '@/lib/pickup-schedule';

export function AdminDashboard() {
  const { data: dashboard, isLoading: isLoadingDashboard, isError: isErrorDashboard, error: errorDashboard, refetch: refetchDashboard } = useGetAdminDashboard();
  const { data: deliveries = [], isLoading: isLoadingDeliveries, isError: isErrorDeliveries, refetch: refetchDeliveries } = useListAdminDeliveries();
  const { data: auditEvents = [], isLoading: isLoadingAudit, isError: isErrorAudit, refetch: refetchAudit } = useListAdminAuditLogs();

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Overview</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Real-time platform operations.</p>
        </div>

        {isLoadingDashboard ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-[hsl(var(--card))]"></div>
            ))}
          </div>
        ) : isErrorDashboard || !dashboard ? (
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-red-500" />
            <p>The desk summary is unavailable. {(errorDashboard as Error | undefined)?.message ?? 'Try refreshing the page.'}</p>
            <button onClick={() => refetchDashboard()} className="mt-4 inline-flex items-center gap-2 rounded bg-[hsl(var(--primary))] px-4 py-2 text-white font-semibold"><RefreshCcw className="h-4 w-4" /> Retry</button>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { label: 'Orders Today', value: dashboard.deliveriesToday, icon: Package, color: 'text-violet-500', bg: 'bg-violet-500/10' },
              { label: 'Active Deliveries', value: dashboard.activeDeliveries, icon: Package, color: 'text-blue-500', bg: 'bg-blue-500/10' },
              { label: 'Drivers Online', value: dashboard.driversOnline, icon: Car, color: 'text-green-500', bg: 'bg-green-500/10' },
              { label: 'Completed Today', value: dashboard.completedToday, icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
              { label: 'Searching Driver', value: dashboard.searchingForDriver, icon: Clock, color: 'text-orange-500', bg: 'bg-orange-500/10' },
              { label: 'Cancelled', value: dashboard.cancelledToday, icon: XCircle, color: 'text-red-500', bg: 'bg-red-500/10' },
              { label: 'Today\'s Revenue', value: dashboard.revenue === undefined ? 'Restricted' : `$${dashboard.revenue.toFixed(2)}`, icon: DollarSign, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
            ].map((stat, i) => (
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
        )}

        <div className="grid gap-6 xl:grid-cols-[1.3fr_.7fr]">
          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div><h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Live delivery queue</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Status and assignment signals from the shared dispatch system.</p></div>
              <Route className="size-5 text-[hsl(var(--primary))]" />
            </div>
            <div className="space-y-3">
              {isLoadingDeliveries ? (
                <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--muted))]/50"></div>
              ) : isErrorDeliveries ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/50 dark:bg-red-900/20">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">Failed to load deliveries</p>
                  <button onClick={() => refetchDeliveries()} className="mt-2 text-xs font-semibold text-red-700 underline dark:text-red-400">Retry</button>
                </div>
              ) : deliveries.length > 0 ? (
                deliveries.slice(0, 4).map((delivery) => (
                  <div key={delivery.id} className="flex items-center justify-between gap-4 rounded-xl bg-[hsl(var(--muted))]/50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{delivery.orderNumber}</p>
                      <p className="mt-1 truncate text-sm text-[hsl(var(--muted-foreground))]">{delivery.pickupAddress} → {delivery.dropoffAddress}</p>
                       <p className="mt-1 text-xs font-semibold text-[hsl(var(--primary))]" data-testid={`text-dashboard-pickup-schedule-${delivery.id}`}>Pickup window: {formatPickupSchedule((delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupStartAt, (delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupEndAt)}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="rounded-full bg-[hsl(var(--card))] px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{delivery.status.replaceAll('_', ' ')}</span>
                      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{delivery.driverName ?? 'Unassigned'}</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">No live deliveries need attention right now.</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2"><BellRing className="size-4 text-[hsl(var(--primary))]" /><h2 className="text-lg font-bold text-[hsl(var(--foreground))]">Notifications</h2></div>
            <div className="space-y-3">
              {isLoadingAudit ? (
                <div className="h-24 animate-pulse rounded-xl bg-[hsl(var(--muted))]/50"></div>
              ) : isErrorAudit ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center dark:border-red-900/50 dark:bg-red-900/20">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300">Failed to load notifications</p>
                  <button onClick={() => refetchAudit()} className="mt-2 text-xs font-semibold text-red-700 underline dark:text-red-400">Retry</button>
                </div>
              ) : auditEvents.length > 0 ? (
                auditEvents.slice(0, 4).map((event) => (
                  <div key={event.id} className="border-l-2 border-[hsl(var(--primary))] pl-3">
                    <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{event.action.replaceAll('_', ' ')}</p>
                    <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{event.entityLabel ?? event.entityType} · {new Date(event.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">New operational alerts and staff actions will appear here.</p>
              )}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-[hsl(var(--foreground))]">Recent Activity Trend</h2>
          <div className="flex h-64 items-end gap-2">
            {isLoadingDashboard ? (
              <div className="h-full w-full animate-pulse rounded-xl bg-[hsl(var(--muted))]/30"></div>
            ) : dashboard?.trend && dashboard.trend.length > 0 ? (
              dashboard.trend.map((point: any, i: number) => {
                const height = Math.max(10, Math.min(100, (point.count || 0) * 10));
                return (
                  <div key={i} className="group relative flex flex-1 flex-col justify-end">
                    <div className="w-full rounded-t-sm bg-[hsl(var(--primary))]/80 transition-all group-hover:bg-[hsl(var(--primary))]" style={{ height: `${height}%` }} />
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
