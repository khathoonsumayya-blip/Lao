import { useState, type ChangeEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { 
  useListAdminDeliveries, getListAdminDeliveriesQueryKey,
  useListApprovedDrivers, getListApprovedDriversQueryKey,
  useListAdminAuditLogs, getListAdminAuditLogsQueryKey,
  useListDispatchAlerts, getListDispatchAlertsQueryKey,
  useAssignDeliveryDriver, 
  useUpdateAdminDeliveryStatus,
  useAcknowledgeDispatchAlert,
  type StaffDelivery,
  type ApprovedDriver,
  type AuditLog,
  type DispatchAlert,
  type DeliveryStatusUpdateStatus,
  type ListAdminDeliveriesParams,
} from '@workspace/api-client-react';
import { AppShell, LoadingState, ErrorState } from '@/components/app-shell';
import { DeliveryMap, type MapPoint } from '@/components/delivery-map';
import { 
  MapPin, Route, UserRound, Navigation, 
  AlertTriangle, CheckCircle2, Car, ShieldAlert,
  Activity, Zap, Search, SlidersHorizontal, ArrowUpDown, BellRing, Check
} from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', quoted: 'Quoted', payment_pending: 'Payment Pending', paid: 'Paid',
  searching_driver: 'Searching Driver', driver_assigned: 'Driver Assigned', 
  driver_en_route_pickup: 'En Route Pickup', driver_arrived_pickup: 'Arrived Pickup',
  pickup_verified: 'Pickup Verified', picked_up: 'Picked Up', in_transit: 'In Transit',
  driver_arrived_delivery: 'Arrived Delivery', delivery_verification_pending: 'Verification Pending',
  delivered: 'Delivered', cancelled: 'Cancelled', failed: 'Failed', refunded: 'Refunded'
};

const STAFF_TRANSITIONS: Record<string, string[]> = {
  driver_assigned: ['driver_en_route_pickup', 'cancelled'],
  driver_en_route_pickup: ['driver_arrived_pickup', 'cancelled'],
  driver_arrived_pickup: ['pickup_verified', 'cancelled'],
  pickup_verified: ['picked_up', 'cancelled'],
  picked_up: ['in_transit', 'failed'],
  in_transit: ['driver_arrived_delivery', 'failed'],
  driver_arrived_delivery: ['delivery_verification_pending', 'failed'],
  delivery_verification_pending: ['failed'],
};

function messageForError(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback;
  const apiError = error as { status?: number; data?: unknown; message?: string };
  if (apiError.data && typeof apiError.data === 'object') {
    const data = apiError.data as { error?: unknown; message?: unknown };
    if (typeof data.error === 'string') return data.error;
    if (typeof data.message === 'string') return data.message;
  }
  return apiError.message || fallback;
}

function isAccessError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status } = error as { status?: unknown };
  return status === 401 || status === 403;
}

const getBadgeColor = (status: string) => {
  if (['draft', 'quoted', 'payment_pending'].includes(status)) return 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] border-[hsl(var(--border))]';
  if (['searching_driver'].includes(status)) return 'bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] border-[hsl(var(--accent))]/20 animate-pulse';
  if (['delivered'].includes(status)) return 'bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2))]/20';
  if (['cancelled', 'failed', 'refunded'].includes(status)) return 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] border-[hsl(var(--destructive))]/20';
  return 'bg-[hsl(var(--chart-3))]/10 text-[hsl(var(--chart-3))] border-[hsl(var(--chart-3))]/20';
};

function StatusAdvancer({ delivery, setActionError }: { delivery: StaffDelivery, setActionError: (msg: string | null) => void }) {
  const queryClient = useQueryClient();
  const updateStatus = useUpdateAdminDeliveryStatus();
  const nextStatuses = STAFF_TRANSITIONS[delivery.status] ?? [];
  
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => {
    const status = e.target.value as DeliveryStatusUpdateStatus;
    if (!status) return;
    
    updateStatus.mutate({ id: delivery.id, data: { status, reason: 'Dispatch manual override' } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDispatchAlertsQueryKey() });
        setActionError(null);
      },
      onError: (error) => {
        setActionError(messageForError(error, 'Failed to update delivery status.'));
        queryClient.invalidateQueries({ queryKey: getListAdminDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDispatchAlertsQueryKey() });
      }
    });
  };

  if (!nextStatuses.length) {
    return <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))]" data-testid={`text-status-guidance-${delivery.id}`}>
      {delivery.status === 'searching_driver' ? 'Assign a driver to continue' : 'Waiting for the next system update'}
    </span>;
  }

  return (
    <select 
      onChange={handleChange} 
      value="" 
      className="w-full text-[11px] font-bold rounded border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 focus:border-[hsl(var(--accent))] focus:ring-1 focus:ring-[hsl(var(--accent))]"
      disabled={updateStatus.isPending}
      data-testid={`select-status-${delivery.id}`}
    >
      <option value="" disabled>Advance status…</option>
      {nextStatuses.map((val) => (
        <option key={val} value={val}>{STATUS_LABELS[val]}</option>
      ))}
    </select>
  );
}

function DriverAssigner({ delivery, drivers, setActionError }: { delivery: StaffDelivery, drivers: ApprovedDriver[], setActionError: (msg: string | null) => void }) {
  const queryClient = useQueryClient();
  const assignDriver = useAssignDeliveryDriver();
  
  const handleAssign = (e: ChangeEvent<HTMLSelectElement>) => {
    const driverId = e.target.value;
    if (!driverId) return;
    
    assignDriver.mutate({ id: delivery.id, data: { driverId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAdminDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
        setActionError(null);
      },
      onError: (error) => {
        setActionError(messageForError(error, 'Failed to assign driver.'));
        queryClient.invalidateQueries({ queryKey: getListAdminDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
      }
    });
  };

  return (
    <select 
      onChange={handleAssign} 
      value={delivery.driverId || ""} 
      className="w-full text-[11px] font-bold rounded border border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5 px-2 py-1.5 text-[hsl(var(--accent))] focus:ring-1 focus:ring-[hsl(var(--accent))]"
      disabled={assignDriver.isPending}
      data-testid={`select-assign-${delivery.id}`}
    >
      <option value="">Assign available driver...</option>
      {drivers.filter(d => d.availabilityStatus === 'available').map(d => (
        <option key={d.id} value={d.id}>{d.name}</option>
      ))}
    </select>
  );
}

function DeliveryCard({ 
  delivery, 
  drivers, 
  setActionError 
}: { 
  delivery: StaffDelivery, 
  drivers: ApprovedDriver[], 
  setActionError: (msg: string | null) => void 
}) {
  const attentionLabel = delivery.isDelayed
    ? 'Delayed'
    : delivery.driverId === null
      ? 'Unassigned'
      : delivery.priority === 'asap'
        ? 'ASAP'
        : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-sm transition-all hover:shadow-md" data-testid={`card-delivery-${delivery.id}`}>
      <div className="absolute top-0 left-0 w-1 h-full bg-[hsl(var(--accent))] opacity-50" />
      
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="font-mono text-xs font-extrabold text-[hsl(var(--primary))]" data-testid={`text-order-${delivery.id}`}>
            {delivery.orderNumber}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[.1em] text-[hsl(var(--muted-foreground))] mt-0.5">
            {delivery.category} • {delivery.care}
          </p>
        </div>
        <div className="text-right">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${getBadgeColor(delivery.status)}`} data-testid={`status-badge-${delivery.id}`}>
            {STATUS_LABELS[delivery.status] || delivery.status}
          </span>
          {attentionLabel && (
            <p className={`mt-1 text-[9px] font-mono font-bold uppercase tracking-wider ${delivery.isDelayed ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--accent))]'}`} data-testid={`badge-attention-${delivery.id}`}>
              {attentionLabel}
            </p>
          )}
          <p className="text-[9px] text-[hsl(var(--muted-foreground))] mt-1 font-mono">
            {new Date(delivery.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
      
      <div className="relative mb-3 space-y-2 rounded-lg bg-[hsl(var(--secondary))]/60 p-2.5 text-[11px]">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--primary))]" />
          <p className="font-medium text-[hsl(var(--primary))] line-clamp-1" data-testid={`text-pickup-${delivery.id}`}>{delivery.pickupAddress}</p>
        </div>
        <div className="ml-[6px] h-2 w-px border-l-2 border-dashed border-[hsl(var(--border))]" />
        <div className="flex items-start gap-2">
          <Route className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--chart-3))]" />
          <p className="font-medium text-[hsl(var(--primary))] line-clamp-1" data-testid={`text-dropoff-${delivery.id}`}>{delivery.dropoffAddress}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-[hsl(var(--muted-foreground))]">Driver</span>
          {delivery.status === 'searching_driver' ? (
            <div className="w-[180px]">
              <DriverAssigner delivery={delivery} drivers={drivers} setActionError={setActionError} />
            </div>
          ) : delivery.driverId ? (
            <div className="flex items-center gap-2 text-right">
              {delivery.driverLocation && (
                <span className="text-[10px] font-mono text-[hsl(var(--chart-2))] flex items-center gap-1 bg-[hsl(var(--chart-2))]/10 px-1.5 py-0.5 rounded border border-[hsl(var(--chart-2))]/20" title="Live location" data-testid={`text-location-${delivery.id}`}>
                  <Navigation className="size-2.5" />
                  {delivery.driverLocation.latitude.toFixed(3)}, {delivery.driverLocation.longitude.toFixed(3)}
                </span>
              )}
              <span className="font-bold text-[hsl(var(--primary))]" data-testid={`text-driver-${delivery.id}`}>{delivery.driverName || 'Assigned'}</span>
            </div>
          ) : (
            <span className="text-[hsl(var(--muted-foreground))] italic text-[11px]" data-testid={`text-driver-${delivery.id}`}>Unassigned</span>
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-[hsl(var(--muted-foreground))]">Status</span>
          <div className="w-[180px]">
            <StatusAdvancer delivery={delivery} setActionError={setActionError} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DriverList({ drivers }: { drivers: ApprovedDriver[] }) {
  if (!drivers.length) return <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="empty-drivers">No approved drivers available.</p>;
  
  return (
    <div className="space-y-2">
      {drivers.map(driver => (
        <div key={driver.id} className="flex items-center justify-between p-2 rounded-lg bg-[hsl(var(--secondary))] text-xs" data-testid={`row-driver-${driver.id}`}>
          <div>
            <p className="font-bold text-[hsl(var(--primary))]">{driver.name}</p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5 flex items-center gap-1">
              <Car className="size-3" />
              {driver.vehicle || 'No vehicle'}
            </p>
          </div>
          <div className="text-right">
            <p className={`font-mono text-[10px] uppercase tracking-wider ${driver.availabilityStatus === 'available' ? 'text-[hsl(var(--chart-2))]' : 'text-[hsl(var(--muted-foreground))]'}`}>
              {driver.availabilityStatus.replace('_', ' ')}
            </p>
            <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-0.5">{driver.totalDeliveries} deliveries</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditLogList({ logs }: { logs: AuditLog[] }) {
  if (!logs.length) return <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="empty-audit-logs">No recent activity.</p>;
  
  return (
    <div className="space-y-3">
      {logs.map(log => (
        <div key={log.id} className="text-xs border-b border-[hsl(var(--border))] pb-2 last:border-0 last:pb-0" data-testid={`row-audit-${log.id}`}>
          <div className="flex justify-between items-start mb-0.5">
            <span className="font-bold text-[hsl(var(--primary))] capitalize">{log.action.replace(/_/g, ' ')}</span>
            <span className="text-[10px] text-[hsl(var(--muted-foreground))] font-mono shrink-0 ml-2">
              {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
           <div className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
             {[log.actorName, log.entityLabel, log.driverName && `Driver ${log.driverName}`].filter(Boolean).join(' · ') || log.entityType}
           </div>
           {log.metadata && Object.keys(log.metadata).length > 0 && (
             <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]" data-testid={`text-audit-context-${log.id}`}>
               {Object.entries(log.metadata).map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1')}: ${String(value)}`).join(' · ')}
             </p>
           )}
            {log.entityId && (
              <div className="mt-1 text-[9px] font-mono text-[hsl(var(--muted-foreground))]/60" title={log.entityId}>
                Audit ref: {log.entityId.slice(0, 8)}
              </div>
            )}
        </div>
      ))}
    </div>
  );
}

function DispatchAlertList({ alerts, setActionError }: { alerts: DispatchAlert[]; setActionError: (message: string | null) => void }) {
  const queryClient = useQueryClient();
  const acknowledgeAlert = useAcknowledgeDispatchAlert();

  if (!alerts.length) {
    return <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="empty-dispatch-alerts">No routes need attention.</p>;
  }

  return (
    <div className="space-y-3" aria-live="polite">
      {alerts.map((alert) => (
        <article key={alert.id} className="rounded-xl border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--destructive))]/5 p-3" data-testid={`dispatch-alert-${alert.id}`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[hsl(var(--destructive))]" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-bold text-[hsl(var(--primary))]">{alert.title}</p>
                <time className="shrink-0 text-[10px] font-mono text-[hsl(var(--muted-foreground))]" dateTime={alert.createdAt}>
                  {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{alert.message}</p>
              <p className="mt-2 text-[11px] font-semibold leading-4 text-[hsl(var(--primary))]">
                Next: <span className="font-normal">{alert.recommendedAction}</span>
              </p>
              <button
                type="button"
                onClick={() => acknowledgeAlert.mutate({ id: alert.id }, {
                  onSuccess: () => {
                    queryClient.invalidateQueries({ queryKey: getListDispatchAlertsQueryKey() });
                    queryClient.invalidateQueries({ queryKey: getListAdminAuditLogsQueryKey() });
                    setActionError(null);
                  },
                  onError: (error) => setActionError(messageForError(error, 'Failed to acknowledge the dispatch alert.')),
                })}
                disabled={acknowledgeAlert.isPending}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-[11px] font-bold text-[hsl(var(--primary))] transition-colors hover:bg-[hsl(var(--secondary))] disabled:cursor-not-allowed disabled:opacity-60"
                data-testid={`button-acknowledge-alert-${alert.id}`}
              >
                <Check className="size-3.5" /> {acknowledgeAlert.isPending ? 'Acknowledging…' : 'Acknowledge'}
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function DispatchPage() {
  const [actionError, setActionError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<NonNullable<ListAdminDeliveriesParams['filter']>>('all');
  const [sort, setSort] = useState<NonNullable<ListAdminDeliveriesParams['sort']>>('urgent');
  const deliveryQueryParams: ListAdminDeliveriesParams = {
    ...(search.trim() ? { search: search.trim() } : {}),
    filter,
    sort,
  };

  const deliveriesQuery = useListAdminDeliveries(deliveryQueryParams, {
    query: { queryKey: getListAdminDeliveriesQueryKey(deliveryQueryParams), refetchInterval: 5000, retry: false }
  });
  const driversQuery = useListApprovedDrivers({ 
    query: { queryKey: getListApprovedDriversQueryKey(), refetchInterval: 15000, retry: false } 
  });
  const auditQuery = useListAdminAuditLogs({ 
    query: { queryKey: getListAdminAuditLogsQueryKey(), refetchInterval: 10000, retry: false } 
  });
  const alertsQuery = useListDispatchAlerts({
    query: { queryKey: getListDispatchAlertsQueryKey(), refetchInterval: 5000, retry: false },
  });

  if ((deliveriesQuery.error && isAccessError(deliveriesQuery.error)) ||
      (driversQuery.error && isAccessError(driversQuery.error)) ||
      (auditQuery.error && isAccessError(auditQuery.error)) ||
      (alertsQuery.error && isAccessError(alertsQuery.error))) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto pt-10 animate-enter">
          <div className="rounded-2xl border border-dashed border-[hsl(var(--destructive))]/50 bg-[hsl(var(--destructive))]/5 p-10 text-center" data-testid="dispatch-access-denied">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
              <ShieldAlert className="size-5" />
            </div>
            <h2 className="font-display text-xl font-bold text-[hsl(var(--destructive))]">Dispatch Access Denied</h2>
            <p className="mx-auto mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              You do not have administrative or dispatcher permissions required to view this workspace.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const deliveries = deliveriesQuery.data || [];
  const drivers = driversQuery.data || [];
  const auditLogs = auditQuery.data || [];
  const dispatchAlerts = alertsQuery.data || [];

  const activeDeliveries = deliveries.filter(d => !['delivered', 'cancelled', 'failed', 'refunded'].includes(d.status));
  const verifiedMapDeliveries = activeDeliveries.filter((delivery) => delivery.mapMode === 'verified');
  const operationsMarkers: MapPoint[] = verifiedMapDeliveries.flatMap((delivery) => [
    { label: `${delivery.orderNumber} pickup`, latitude: delivery.pickupLatitude, longitude: delivery.pickupLongitude, kind: 'pickup' as const },
    { label: `${delivery.orderNumber} destination`, latitude: delivery.dropoffLatitude, longitude: delivery.dropoffLongitude, kind: 'dropoff' as const },
    ...(delivery.driverLocation ? [{ label: `${delivery.orderNumber} driver`, latitude: delivery.driverLocation.latitude, longitude: delivery.driverLocation.longitude, kind: 'driver' as const }] : []),
  ]);

  return (
    <AppShell>
      <div className="animate-enter max-w-[1400px] mx-auto">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end justify-between border-b border-[hsl(var(--border))] pb-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-[-.055em] text-[hsl(var(--primary))] uppercase flex items-center gap-3">
              <Activity className="size-6 text-[hsl(var(--accent))]" />
              Dispatch Control
            </h1>
            <p className="mt-1 text-xs font-mono uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
              Raleigh Cargo Desk • Live Updates
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/operations" className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(var(--card))] border border-[hsl(var(--border))] text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary))] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <SlidersHorizontal className="size-3 text-[hsl(var(--accent))]" /> Operations
            </Link>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[hsl(var(--secondary))] border border-[hsl(var(--border))]">
              <div className="size-2 rounded-full bg-[hsl(var(--chart-2))] animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary))]">System Online</span>
            </div>
          </div>
        </div>

        {actionError && (
          <div className="mb-6 rounded-xl bg-[hsl(var(--destructive))]/10 border border-[hsl(var(--destructive))]/20 p-4 flex items-center justify-between" data-testid="dispatch-error-banner">
            <div className="flex items-center gap-3">
              <AlertTriangle className="size-4 text-[hsl(var(--destructive))]" />
              <p className="text-sm font-bold text-[hsl(var(--destructive))]">{actionError}</p>
            </div>
            <button onClick={() => setActionError(null)} className="text-xs font-bold text-[hsl(var(--destructive))]/70 hover:text-[hsl(var(--destructive))]" data-testid="button-dismiss-dispatch-error">Dismiss</button>
          </div>
        )}

        <section className="mb-6 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft" aria-label="Delivery queue controls">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
            <label className="block flex-1">
              <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Find a route</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Order number, address, or driver"
                  className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] py-2.5 pl-9 pr-3 text-sm font-medium text-[hsl(var(--primary))] outline-none placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent))]/10"
                  data-testid="input-delivery-search"
                />
              </span>
            </label>
            <label className="block min-w-[180px]">
              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]"><SlidersHorizontal className="size-3" /> Queue</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as NonNullable<ListAdminDeliveriesParams['filter']>)} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm font-bold text-[hsl(var(--primary))] outline-none focus:border-[hsl(var(--accent))]" data-testid="select-delivery-filter">
                <option value="all">All active routes</option>
                <option value="unassigned">Unassigned</option>
                <option value="delayed">Delayed</option>
                <option value="in_progress">In progress</option>
              </select>
            </label>
            <label className="block min-w-[180px]">
              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]"><ArrowUpDown className="size-3" /> Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as NonNullable<ListAdminDeliveriesParams['sort']>)} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm font-bold text-[hsl(var(--primary))] outline-none focus:border-[hsl(var(--accent))]" data-testid="select-delivery-sort">
                <option value="urgent">Urgency first</option>
                <option value="recently_changed">Recently changed</option>
              </select>
            </label>
          </div>
        </section>

        <section className="mb-6 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-soft">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--accent))]">Live operations map</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Pickup, destination, and authorized driver markers from the shared delivery backend.</p></div>
            <Navigation className="size-5 text-[hsl(var(--primary))]" />
          </div>
          <DeliveryMap markers={operationsMarkers} title="Dispatch live operations map" demoMode={operationsMarkers.length === 0} />
          {activeDeliveries.length > verifiedMapDeliveries.length && <p className="mt-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Some active deliveries are in DEMO MAP MODE and are intentionally excluded from live navigation until their addresses are verified.</p>}
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]" data-testid="text-delivery-results">Active Deliveries ({activeDeliveries.length})</h2>
              {deliveriesQuery.isFetching && <Zap className="size-3 text-[hsl(var(--accent))] animate-pulse" />}
            </div>
            
            {deliveriesQuery.isLoading ? (
              <LoadingState label="Loading active routes..." />
            ) : deliveriesQuery.isError ? (
              <ErrorState title="Failed to load deliveries" onRetry={() => deliveriesQuery.refetch()} />
            ) : activeDeliveries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))]/50 p-10 text-center" data-testid="dispatch-empty-deliveries">
                <CheckCircle2 className="mx-auto size-8 text-[hsl(var(--muted-foreground))]/50 mb-3" />
                <p className="text-sm font-bold text-[hsl(var(--primary))]">{search || filter !== 'all' ? 'No matching routes' : 'Desk is clear'}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">{search || filter !== 'all' ? 'Try a different search or queue filter.' : 'No active deliveries require routing.'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeDeliveries.map(delivery => (
                  <DeliveryCard 
                    key={delivery.id} 
                    delivery={delivery} 
                    drivers={drivers} 
                    setActionError={setActionError} 
                  />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl border border-[hsl(var(--destructive))]/25 bg-[hsl(var(--card))] overflow-hidden shadow-soft" data-testid="dispatch-alerts-panel">
              <div className="bg-[hsl(var(--destructive))]/10 px-4 py-3 border-b border-[hsl(var(--destructive))]/20 flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">Route Alerts {dispatchAlerts.length > 0 && <span className="ml-1 rounded-full bg-[hsl(var(--destructive))] px-1.5 py-0.5 text-[10px] text-[hsl(var(--destructive-foreground))]">{dispatchAlerts.length}</span>}</h3>
                <BellRing className={`size-3.5 ${dispatchAlerts.length ? 'text-[hsl(var(--destructive))] animate-pulse' : 'text-[hsl(var(--muted-foreground))]'}`} />
              </div>
              <div className="p-3 max-h-[380px] overflow-y-auto">
                {alertsQuery.isLoading ? (
                  <div className="space-y-2"><div className="h-24 bg-[hsl(var(--muted))] rounded animate-pulse" /></div>
                ) : alertsQuery.isError ? (
                  <p className="text-xs text-[hsl(var(--destructive))]" data-testid="dispatch-alerts-error">Unable to load route alerts.</p>
                ) : (
                  <DispatchAlertList alerts={dispatchAlerts} setActionError={setActionError} />
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden shadow-soft">
              <div className="bg-[hsl(var(--secondary))] px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">Fleet Roster</h3>
                <Car className="size-3.5 text-[hsl(var(--muted-foreground))]" />
              </div>
              <div className="p-3 max-h-[300px] overflow-y-auto">
                {driversQuery.isLoading ? (
                  <div className="space-y-2"><div className="h-10 bg-[hsl(var(--muted))] rounded animate-pulse" /></div>
                ) : (
                  <DriverList drivers={drivers} />
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden shadow-soft">
              <div className="bg-[hsl(var(--secondary))] px-4 py-3 border-b border-[hsl(var(--border))] flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--primary))]">Audit Log</h3>
                <Activity className="size-3.5 text-[hsl(var(--muted-foreground))]" />
              </div>
              <div className="p-3 max-h-[400px] overflow-y-auto">
                {auditQuery.isLoading ? (
                  <div className="space-y-2"><div className="h-10 bg-[hsl(var(--muted))] rounded animate-pulse" /></div>
                ) : (
                  <AuditLogList logs={auditLogs} />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
