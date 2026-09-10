import { useState } from 'react';
import {
  useAssignDeliveryDriver,
  useListAdminDeliveries,
  useListApprovedDrivers,
  useUpdateAdminDeliveryStatus,
} from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { format } from 'date-fns';
import { Package, Search, Filter } from 'lucide-react';

export function AdminDeliveries() {
  const { data: deliveries, isLoading, refetch } = useListAdminDeliveries();
  const { data: drivers = [] } = useListApprovedDrivers();
  const [search, setSearch] = useState('');
  const [assignment, setAssignment] = useState<Record<string, string>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');
  const assignDriver = useAssignDeliveryDriver();
  const updateStatus = useUpdateAdminDeliveryStatus();

  const filtered = deliveries?.filter((d) => 
    d.id.toLowerCase().includes(search.toLowerCase()) ||
    d.pickupAddress.toLowerCase().includes(search.toLowerCase()) ||
    d.dropoffAddress.toLowerCase().includes(search.toLowerCase())
  );

  const updateDelivery = async (id: string) => {
    const status = statusDrafts[id];
    if (!status) return;
    setActionError('');
    try {
      await updateStatus.mutateAsync({ id, data: { status: status as 'searching_driver' | 'driver_assigned' | 'in_transit' | 'cancelled' } });
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not update this delivery.');
    }
  };

  const assign = async (id: string) => {
    const driverId = assignment[id];
    if (!driverId) return;
    setActionError('');
    try {
      await assignDriver.mutateAsync({ id, data: { driverId } });
      await refetch();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not assign this driver.');
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Deliveries</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Manage and monitor all platform deliveries.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search ID or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-9 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
            <button className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]">
              <Filter className="size-4" /> Filter
            </button>
          </div>
        </div>
        {actionError && <p className="rounded-xl bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm font-medium text-[hsl(var(--destructive))]">{actionError}</p>}

        <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="px-6 py-4 font-semibold">ID</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold">Pickup</th>
                  <th className="px-6 py-4 font-semibold">Dropoff</th>
                  <th className="px-6 py-4 font-semibold">Driver assignment</th>
                  <th className="px-6 py-4 font-semibold">Live status</th>
                  <th className="px-6 py-4 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 w-16 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-32 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-32 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-28 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-28 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-[hsl(var(--muted))]"></div></td>
                    </tr>
                  ))
                ) : filtered && filtered.length > 0 ? (
                  filtered.map((delivery) => (
                    <tr key={delivery.id} className="transition-colors hover:bg-[hsl(var(--muted))]/30">
                      <td className="px-6 py-4 font-mono text-xs font-semibold text-[hsl(var(--primary))]">
                        #{delivery.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold uppercase tracking-wider ${
                          delivery.status === 'completed' ? 'bg-emerald-500/10 text-emerald-600' :
                          delivery.status === 'cancelled' ? 'bg-red-500/10 text-red-600' :
                          delivery.status === 'in_transit' ? 'bg-blue-500/10 text-blue-600' :
                          'bg-orange-500/10 text-orange-600'
                        }`}>
                          {delivery.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-[hsl(var(--foreground))]">
                        <div className="max-w-[200px] truncate" title={delivery.pickupAddress}>{delivery.pickupAddress}</div>
                      </td>
                      <td className="px-6 py-4 text-[hsl(var(--foreground))]">
                        <div className="max-w-[200px] truncate" title={delivery.dropoffAddress}>{delivery.dropoffAddress}</div>
                      </td>
                      <td className="px-6 py-4">
                        {delivery.driverName ? (
                          <span className="font-medium text-[hsl(var(--foreground))]">{delivery.driverName}</span>
                        ) : (
                          <div className="flex min-w-[220px] gap-2">
                            <select
                              aria-label={`Assign a driver to ${delivery.orderNumber}`}
                              value={assignment[delivery.id] ?? ''}
                              onChange={(event) => setAssignment((current) => ({ ...current, [delivery.id]: event.target.value }))}
                              className="min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs"
                              data-testid={`select-driver-${delivery.id}`}
                            >
                              <option value="">Choose driver</option>
                              {drivers.filter((driver) => driver.availabilityStatus === 'online').map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                            </select>
                            <button onClick={() => assign(delivery.id)} disabled={!assignment[delivery.id] || assignDriver.isPending} className="rounded-lg bg-[hsl(var(--primary))] px-2 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))] disabled:opacity-50" data-testid={`button-assign-${delivery.id}`}>Assign</button>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex min-w-[196px] gap-2">
                          <select
                            aria-label={`Update status for ${delivery.orderNumber}`}
                            value={statusDrafts[delivery.id] ?? delivery.status}
                            onChange={(event) => setStatusDrafts((current) => ({ ...current, [delivery.id]: event.target.value }))}
                            className="min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs"
                            data-testid={`select-status-${delivery.id}`}
                          >
                            <option value="searching_driver">Searching driver</option>
                            <option value="driver_assigned">Driver assigned</option>
                            <option value="in_transit">In transit</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                          <button onClick={() => updateDelivery(delivery.id)} disabled={!statusDrafts[delivery.id] || updateStatus.isPending} className="rounded-lg border border-[hsl(var(--border))] px-2 py-1.5 text-xs font-bold hover:bg-[hsl(var(--muted))] disabled:opacity-50" data-testid={`button-status-${delivery.id}`}>Apply</button>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                        {format(new Date(delivery.createdAt), 'MMM d, h:mm a')}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-[hsl(var(--muted-foreground))]">
                      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                        <Package className="size-6 text-[hsl(var(--muted-foreground))]" />
                      </div>
                      <p className="mt-4 text-sm">No deliveries found.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
