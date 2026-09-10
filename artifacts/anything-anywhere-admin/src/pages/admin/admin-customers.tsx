import { useState, useMemo, useEffect } from 'react';
import { useListAdminCustomers, useGetAdminCustomer, useUpdateAdminCustomerStatus, getGetAdminCustomerQueryKey, getListAdminCustomersQueryKey } from '@workspace/api-client-react';
import type { AdminCustomerStatusUpdateInputStatus, AdminCustomerListItem } from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { Loader2, AlertCircle, RefreshCcw, Search, User, ShieldAlert, CheckCircle2, ChevronRight, X, Package } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"><CheckCircle2 className="size-3" /> Active</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-800 dark:bg-red-900/30 dark:text-red-400"><ShieldAlert className="size-3" /> Suspended</span>;
}

export function AdminCustomers() {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const { data: customers = [], isLoading, isError, refetch } = useListAdminCustomers(
    { search: debouncedQuery || undefined },
    { query: { queryKey: ['admin-customers', debouncedQuery] } }
  );

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredCustomers = useMemo(() => {
    // Client-side filtering as an immediate fallback while server fetches
    if (!searchQuery.trim()) return customers;
    const q = searchQuery.toLowerCase();
    return customers.filter(c =>
      c.firstName.toLowerCase().includes(q) ||
      c.lastName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.phone && c.phone.toLowerCase().includes(q))
    );
  }, [customers, searchQuery]);

  return (
    <AdminLayout>
      <div className="flex h-[calc(100dvh-7rem)] min-h-[600px] flex-col md:h-[calc(100dvh-9rem)]">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Customers</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">View customer accounts and delivery history.</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search customers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2 pl-9 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-sm">
          {/* List Pane */}
          <div className={`flex flex-col border-r bg-[hsl(var(--card))] transition-all ${selectedCustomerId ? 'hidden lg:flex lg:w-1/3 xl:w-2/5' : 'w-full lg:w-1/3 xl:w-2/5'}`}>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex h-32 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]"><Loader2 className="mr-2 size-4 animate-spin" /> Loading customers...</div>
              ) : isError ? (
                <div className="p-6 text-center">
                  <AlertCircle className="mx-auto size-8 text-[hsl(var(--destructive))]" />
                  <p className="mt-2 text-sm font-semibold">Customers could not be loaded.</p>
                  <button onClick={() => refetch()} className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]">Retry</button>
                </div>
              ) : filteredCustomers.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-center text-[hsl(var(--muted-foreground))]">
                  <User className="mb-2 size-8 opacity-20" />
                  <p className="text-sm">No customers found.</p>
                </div>
              ) : (
                <ul className="divide-y">
                  {filteredCustomers.map((customer) => (
                    <li key={customer.id}>
                      <button
                        onClick={() => setSelectedCustomerId(customer.id)}
                        className={`w-full p-4 text-left transition-colors hover:bg-[hsl(var(--muted))]/50 ${selectedCustomerId === customer.id ? 'bg-[hsl(var(--primary))]/5' : ''}`}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-bold">{customer.firstName} {customer.lastName}</span>
                          <StatusBadge status={customer.status} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="truncate text-[hsl(var(--muted-foreground))]">{customer.email}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-medium text-[hsl(var(--muted-foreground))]">
                          <span>Joined {new Date(customer.createdAt).toLocaleDateString()}</span>
                          <span>{customer.deliveryCount} Deliveries</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Detail Pane */}
          {selectedCustomerId ? (
            <div className={`flex flex-col bg-[hsl(var(--card))] ${selectedCustomerId ? 'flex-1' : 'hidden'}`}>
              <CustomerDetail
                id={selectedCustomerId}
                onClose={() => setSelectedCustomerId(null)}
              />
            </div>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))] lg:flex">
              <User className="mb-4 size-12 opacity-20" />
              <p>Select a customer to view details</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useGetAdminCustomer(id, { query: { enabled: !!id, queryKey: getGetAdminCustomerQueryKey(id) } });
  const updateStatus = useUpdateAdminCustomerStatus();

  const [suspendReason, setSuspendReason] = useState('');

  const handleStatusUpdate = async (newStatus: AdminCustomerStatusUpdateInputStatus) => {
    if (newStatus === 'suspended' && suspendReason.trim().length < 3) {
      alert('Please provide a reason for suspension.');
      return;
    }

    if (newStatus === 'suspended' && !confirm('Are you sure you want to suspend this customer? All active sessions will be revoked.')) return;
    if (newStatus === 'active' && !confirm('Are you sure you want to reactivate this customer?')) return;

    try {
      await updateStatus.mutateAsync({
        id,
        data: { status: newStatus, reason: newStatus === 'suspended' ? suspendReason : undefined }
      });
      setSuspendReason('');

      // Invalidate both lists and detail
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminCustomersQueryKey() }),
        refetch()
      ]);
    } catch (e) {
      alert('Failed to update customer status.');
    }
  };

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-[hsl(var(--muted-foreground))]"><Loader2 className="mr-2 size-4 animate-spin" /> Loading customer details...</div>;
  }

  if (isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="mx-auto size-8 text-[hsl(var(--destructive))]" />
        <p className="mt-2 text-sm font-semibold">Customer details could not be loaded.</p>
        <button onClick={() => refetch()} className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]">Retry</button>
      </div>
    );
  }

  const { customer, deliveries, supportTickets } = data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[hsl(var(--muted))] lg:hidden">
            <X className="size-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold">{customer.firstName} {customer.lastName}</h2>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Joined {new Date(customer.createdAt).toLocaleDateString()}</p>
          </div>
        </div>
        <StatusBadge status={customer.status} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Contact Info</h3>
              <div className="rounded-xl border bg-[hsl(var(--background))] p-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Email</span>
                  <a href={`mailto:${customer.email}`} className="text-sm font-medium hover:underline">{customer.email}</a>
                </div>
                <div>
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Phone</span>
                  {customer.phone ? (
                    <a href={`tel:${customer.phone}`} className="text-sm font-medium hover:underline">{customer.phone}</a>
                  ) : (
                    <span className="text-sm text-[hsl(var(--muted-foreground))]">Not provided</span>
                  )}
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Delivery History ({deliveries.length})</h3>
              <div className="rounded-xl border bg-[hsl(var(--background))] overflow-hidden">
                {deliveries.length > 0 ? (
                  <div className="divide-y">
                    {deliveries.map((delivery) => (
                      <div key={delivery.id} className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-mono text-xs font-bold text-[hsl(var(--primary))]">{delivery.orderNumber}</p>
                          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{new Date(delivery.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <span className="inline-flex rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                            {delivery.status.replace(/_/g, ' ')}
                          </span>
                          <p className="mt-1 text-sm font-semibold">${Number(delivery.total).toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                    <Package className="mx-auto mb-2 size-6 opacity-20" />
                    No deliveries yet.
                  </div>
                )}
              </div>
            </section>

            {supportTickets.length > 0 && (
              <section>
                <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Support Tickets ({supportTickets.length})</h3>
                <div className="rounded-xl border bg-[hsl(var(--background))] overflow-hidden divide-y">
                  {supportTickets.map((ticket) => (
                    <div key={ticket.id} className="p-4">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-xs font-bold uppercase">{ticket.category.replace(/_/g, ' ')}</span>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-[hsl(var(--muted))]">{ticket.status}</span>
                      </div>
                      <p className="text-sm line-clamp-2 text-[hsl(var(--muted-foreground))]">{ticket.message}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <div className="space-y-6">
            <section>
              <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Account Actions</h3>
              <div className="rounded-xl border bg-[hsl(var(--background))] p-4 space-y-4">
                {customer.status === 'active' ? (
                  <div className="space-y-3">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Suspending this account will immediately revoke all active sessions and prevent new sign-ins or orders.
                    </p>
                    <input
                      type="text"
                      placeholder="Reason for suspension..."
                      value={suspendReason}
                      onChange={(e) => setSuspendReason(e.target.value)}
                      className="w-full rounded-lg border bg-[hsl(var(--background))] px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => handleStatusUpdate('suspended')}
                      disabled={updateStatus.isPending || !suspendReason.trim()}
                      className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                    >
                      {updateStatus.isPending ? 'Suspending...' : 'Suspend Account'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      This account is suspended. Reactivating will restore full access.
                    </p>
                    <button
                      onClick={() => handleStatusUpdate('active')}
                      disabled={updateStatus.isPending}
                      className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {updateStatus.isPending ? 'Reactivating...' : 'Reactivate Account'}
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
