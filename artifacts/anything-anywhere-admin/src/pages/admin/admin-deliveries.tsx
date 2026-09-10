import {
  useListAdminDeliveries,
  useListApprovedDrivers,
  useGetAdminDashboard,
  useAssignDeliveryDriver,
  useUpdateAdminDeliveryStatus,
  getListAdminDeliveriesQueryKey,
  getListApprovedDriversQueryKey,
  getGetAdminDashboardQueryKey,
} from '@workspace/api-client-react';
import type { DeliveryStatusUpdateStatus } from '@workspace/api-client-react';
import { useRef, useState } from 'react';
import { AdminLayout } from './admin-layout';
import { Loader2, AlertCircle, RefreshCcw, Box, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { formatPickupSchedule } from '@/lib/pickup-schedule';

export function AdminDeliveries() {
  const {
    data: deliveries,
    isLoading,
    isError,
    error: deliveriesError,
    refetch: refetchDeliveries,
  } = useListAdminDeliveries(
    { sort: 'recently_changed' },
    { query: { queryKey: getListAdminDeliveriesQueryKey({ sort: 'recently_changed' }), retry: false } },
  );
  const {
    data: drivers = [],
    isLoading: isLoadingDrivers,
    isError: isDriversError,
    error: driversError,
    refetch: refetchDrivers,
  } = useListApprovedDrivers({
    query: { queryKey: getListApprovedDriversQueryKey(), retry: false },
  });
  const {
    data: summary,
    isError: isSummaryError,
    error: summaryError,
    refetch: refetchSummary,
  } = useGetAdminDashboard({
    query: { queryKey: getGetAdminDashboardQueryKey(), retry: false },
  });
  const assign = useAssignDeliveryDriver();
  const update = useUpdateAdminDeliveryStatus();

  const [driverId, setDriverId] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Record<string, string>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshLock = useRef(false);
  const refreshButtonRef = useRef<HTMLButtonElement>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const deliveryList = deliveries ?? [];
  const retainedDataError =
    (isError && deliveries ? deliveriesError : null)
    ?? (isDriversError && deliveries ? driversError : null)
    ?? (isSummaryError && summary ? summaryError : null);
  const visibleRefreshError = refreshError
    ?? (retainedDataError instanceof Error ? retainedDataError.message : retainedDataError ? 'Could not refresh delivery data.' : null);

  const handleRefresh = async () => {
    if (refreshLock.current) return;

    refreshLock.current = true;
    if (refreshButtonRef.current) refreshButtonRef.current.disabled = true;
    setIsRefreshing(true);
    setRefreshError(null);
    const startedAt = Date.now();
    const keepProgressVisible = async () => {
      const remaining = 2_500 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
    };

    try {
      const [deliveriesResult, driversResult, summaryResult] = await Promise.all([
        refetchDeliveries(),
        refetchDrivers(),
        refetchSummary(),
      ]);

      if (deliveriesResult.isError || driversResult.isError || summaryResult.isError) {
        throw deliveriesResult.error ?? driversResult.error ?? summaryResult.error ?? new Error('Could not refresh delivery data.');
      }

      await keepProgressVisible();
      setLastRefreshed(new Date());
    } catch (error) {
      await keepProgressVisible();
      setRefreshError(error instanceof Error ? error.message : 'Could not refresh deliveries and drivers. Please try again.');
    } finally {
      refreshLock.current = false;
      if (refreshButtonRef.current) refreshButtonRef.current.disabled = false;
      setIsRefreshing(false);
    }
  };

  const handleAssign = async (deliveryId: string) => {
    const selectedDriver = driverId[deliveryId];
    if (!selectedDriver) {
      alert('Please select a driver to assign.');
      return;
    }
    try {
      await assign.mutateAsync({ id: deliveryId, data: { driverId: selectedDriver } });
      await handleRefresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'This delivery could not be updated.');
    }
  };

  const handleStatusUpdate = async (deliveryId: string, currentStatus: string) => {
    const selectedStatus = status[deliveryId] || currentStatus;
    if (!selectedStatus || selectedStatus === currentStatus) return;

    try {
      await update.mutateAsync({ id: deliveryId, data: { status: selectedStatus as DeliveryStatusUpdateStatus } });
      await handleRefresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'This delivery could not be updated.');
    }
  };

  const STATUS_OPTIONS: { value: DeliveryStatusUpdateStatus, label: string }[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'quoted', label: 'Quoted' },
    { value: 'searching_driver', label: 'Searching Driver' },
    { value: 'driver_assigned', label: 'Driver Assigned' },
    { value: 'driver_en_route_pickup', label: 'En Route to Pickup' },
    { value: 'driver_arrived_pickup', label: 'Arrived at Pickup' },
    { value: 'pickup_verified', label: 'Pickup Verified' },
    { value: 'picked_up', label: 'Picked Up' },
    { value: 'in_transit', label: 'In Transit' },
    { value: 'driver_arrived_delivery', label: 'Arrived at Delivery' },
    { value: 'delivery_verification_pending', label: 'Delivery Verification Pending' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'failed', label: 'Failed' },
  ];

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Deliveries</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Manage and monitor all platform deliveries.</p>
          </div>
          <button
            ref={refreshButtonRef}
            onClick={handleRefresh}
            disabled={isRefreshing || assign.isPending || update.isPending}
            aria-busy={isRefreshing}
            className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            <RefreshCcw className={`size-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {summary ? (
          <section aria-label="Delivery summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Orders Today', summary.deliveriesToday],
              ['Active', summary.activeDeliveries],
              ['Completed Today', summary.completedToday],
              ['Searching Driver', summary.searchingForDriver],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border bg-[hsl(var(--card))] p-4 shadow-sm">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{label}</p>
                <p className="mt-2 text-2xl font-extrabold">{value}</p>
              </div>
            ))}
          </section>
        ) : null}

        {lastRefreshed && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">
            Last refreshed {format(lastRefreshed, 'MMM d, yyyy h:mm:ss a')}
          </p>
        )}

        {visibleRefreshError && (
          <div role="alert" className="rounded-lg border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]">
            Refresh failed: {visibleRefreshError}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-sm">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="mb-4 size-8 animate-spin text-[hsl(var(--primary))]" />
              <p>Loading deliveries...</p>
            </div>
          ) : isError && !deliveries ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <AlertCircle className="mb-4 size-10 text-[hsl(var(--destructive))]" />
              <p className="font-semibold">Failed to load deliveries.</p>
              <button onClick={handleRefresh} disabled={isRefreshing} className="mt-4 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-white font-semibold shadow-sm disabled:opacity-50">Retry</button>
            </div>
          ) : deliveryList.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-[hsl(var(--muted-foreground))]">
              <Box className="mb-4 size-12 opacity-20" />
              <p>No deliveries found in the system.</p>
            </div>
          ) : (
            <div className="divide-y">
              {deliveryList.map((delivery) => (
                <article key={delivery.id} className="p-6 transition-colors hover:bg-[hsl(var(--muted))]/30">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">

                    <div className="flex-1 space-y-3">
                      <div className="flex items-start justify-between lg:justify-start lg:gap-4">
                        <div>
                          <p className="font-mono text-sm font-bold text-[hsl(var(--primary))]">{delivery.orderNumber}</p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">Created {format(new Date(delivery.createdAt), 'MMM d, yyyy h:mm a')}</p>
                        </div>
                        <span className="inline-flex items-center rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--foreground))]">
                          {delivery.status.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="rounded-lg bg-[hsl(var(--background))] p-3 border">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Pickup</span>
                          <p className="mt-1 text-sm font-medium">{delivery.pickupAddress}</p>
                        </div>
                        <div className="rounded-lg bg-[hsl(var(--background))] p-3 border">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Drop-off</span>
                          <p className="mt-1 text-sm font-medium">{delivery.dropoffAddress}</p>
                        </div>
                      </div>
                      <div className="rounded-lg border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/5 p-3" data-testid={`text-admin-pickup-schedule-${delivery.id}`}>
                        <span className="block text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Pickup window</span>
                        <p className="mt-1 text-sm font-semibold text-[hsl(var(--primary))]">{formatPickupSchedule((delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupStartAt, (delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupEndAt)}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        {delivery.driverName && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Driver:</span>
                            <span className="font-semibold">{delivery.driverName}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col gap-3 rounded-xl border bg-[hsl(var(--background))] p-4 lg:w-72">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Assign Driver</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <select
                              aria-label={`Assign a driver to ${delivery.orderNumber}`}
                              value={driverId[delivery.id] ?? ''}
                              onChange={(event) => setDriverId({ ...driverId, [delivery.id]: event.target.value })}
                              disabled={isLoadingDrivers || assign.isPending}
                              className="w-full appearance-none rounded-lg border bg-[hsl(var(--card))] py-1.5 pl-3 pr-8 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] disabled:opacity-50"
                            >
                              <option value="">Choose driver</option>
                              {drivers
                                .filter((driver) => driver.availabilityStatus === 'online')
                                .map((driver) => (
                                  <option key={driver.id} value={driver.id}>{driver.name} (Online)</option>
                                ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-[hsl(var(--muted-foreground))]" />
                          </div>
                          <button
                            disabled={!driverId[delivery.id] || assign.isPending}
                            onClick={() => handleAssign(delivery.id)}
                            className="flex items-center justify-center rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))] shadow-sm disabled:opacity-50"
                          >
                            Assign
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Update Status</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <select
                              aria-label={`Update status for ${delivery.orderNumber}`}
                              value={status[delivery.id] ?? delivery.status}
                              onChange={(event) => setStatus({ ...status, [delivery.id]: event.target.value })}
                              disabled={update.isPending}
                              className="w-full appearance-none rounded-lg border bg-[hsl(var(--card))] py-1.5 pl-3 pr-8 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] disabled:opacity-50"
                            >
                              {STATUS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-[hsl(var(--muted-foreground))]" />
                          </div>
                          <button
                            disabled={update.isPending || (!status[delivery.id] && delivery.status === 'cancelled') || status[delivery.id] === delivery.status}
                            onClick={() => handleStatusUpdate(delivery.id, delivery.status)}
                            className="flex items-center justify-center rounded-lg border bg-[hsl(var(--background))] px-3 py-1.5 text-xs font-bold shadow-sm hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
