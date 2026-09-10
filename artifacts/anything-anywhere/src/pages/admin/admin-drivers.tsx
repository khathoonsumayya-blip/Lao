import { useState } from 'react';
import { useListAdminDriverReview, useDecideAdminDriver } from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { Car, Search, ShieldAlert, ShieldCheck } from 'lucide-react';
import { format } from 'date-fns';

export function AdminDrivers() {
  const { data: drivers, isLoading, refetch } = useListAdminDriverReview();
  const [search, setSearch] = useState('');
  const decideMutation = useDecideAdminDriver();

  // Typecast unknown schema
  const typedDrivers = (drivers as any[]) || [];
  
  const filtered = typedDrivers.filter((d) => 
    (d.email && d.email.toLowerCase().includes(search.toLowerCase())) ||
    (d.firstName && d.firstName.toLowerCase().includes(search.toLowerCase())) ||
    (d.lastName && d.lastName.toLowerCase().includes(search.toLowerCase()))
  );

  const handleDecision = async (driverId: string, status: 'approved' | 'rejected') => {
    try {
      await decideMutation.mutateAsync({
        id: driverId,
        data: { decision: status, reason: `Reviewed and ${status} by staff.` },
      });
      refetch();
    } catch (e) {
      console.error(e);
      alert('Failed to update driver status');
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Drivers</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Review driver onboarding applications and manage active drivers.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search drivers..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-9 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"></div>
            ))
          ) : filtered.length > 0 ? (
            filtered.map((driver, idx) => (
              <div key={driver.id || idx} className="flex flex-col justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-sm">
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-full bg-[hsl(var(--muted))] font-bold text-[hsl(var(--foreground))]">
                        {(driver.firstName?.[0] || '') + (driver.lastName?.[0] || '')}
                      </div>
                      <div>
                        <h3 className="font-semibold text-[hsl(var(--foreground))]">{driver.firstName} {driver.lastName}</h3>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">{driver.email}</p>
                      </div>
                    </div>
                    {driver.status === 'pending' ? (
                      <span className="flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-orange-600">
                        <ShieldAlert className="size-3" /> Pending
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                        <ShieldCheck className="size-3" /> Approved
                      </span>
                    )}
                  </div>

                  <div className="mt-6 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">Vehicle</span>
                      <span className="font-medium text-[hsl(var(--foreground))]">{driver.vehicleMake || 'Unknown'} {driver.vehicleModel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[hsl(var(--muted-foreground))]">Applied</span>
                      <span className="font-medium text-[hsl(var(--foreground))]">
                        {driver.createdAt ? format(new Date(driver.createdAt), 'MMM d, yyyy') : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-[hsl(var(--border))]">
                  {driver.status === 'pending' ? (
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleDecision(driver.id, 'approved')}
                        disabled={decideMutation.isPending}
                        className="flex-1 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-600 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button 
                        onClick={() => handleDecision(driver.id, 'rejected')}
                        disabled={decideMutation.isPending}
                        className="flex-1 rounded-xl bg-red-500 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <button className="w-full rounded-xl border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-xs font-bold text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]">
                      View Profile
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full rounded-2xl border border-dashed border-[hsl(var(--border))] p-12 text-center text-[hsl(var(--muted-foreground))]">
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <Car className="size-6 text-[hsl(var(--muted-foreground))]" />
              </div>
              <p>No drivers found.</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
