import { useState } from 'react';
import { useListAdminCustomers } from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { Users, Search } from 'lucide-react';
import { format } from 'date-fns';

export function AdminCustomers() {
  const { data: customers, isLoading } = useListAdminCustomers();
  const [search, setSearch] = useState('');

  // Since the schema is `unknown`, we typecast to what we expect.
  const typedCustomers = (customers as any[]) || [];
  
  const filtered = typedCustomers.filter((c) => 
    (c.email && c.email.toLowerCase().includes(search.toLowerCase())) ||
    (c.firstName && c.firstName.toLowerCase().includes(search.toLowerCase())) ||
    (c.lastName && c.lastName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Customers</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">View and manage customer accounts.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search email or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-9 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))]">
                <tr>
                  <th className="px-6 py-4 font-semibold">Name</th>
                  <th className="px-6 py-4 font-semibold">Email</th>
                  <th className="px-6 py-4 font-semibold">Joined</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4"><div className="h-4 w-32 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-48 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-24 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="h-4 w-16 rounded bg-[hsl(var(--muted))]"></div></td>
                      <td className="px-6 py-4"><div className="ml-auto h-4 w-12 rounded bg-[hsl(var(--muted))]"></div></td>
                    </tr>
                  ))
                ) : filtered.length > 0 ? (
                  filtered.map((customer, idx) => (
                    <tr key={customer.id || idx} className="transition-colors hover:bg-[hsl(var(--muted))]/30">
                      <td className="px-6 py-4 font-medium text-[hsl(var(--foreground))]">
                        {customer.firstName} {customer.lastName}
                      </td>
                      <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                        {customer.email}
                      </td>
                      <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">
                        {customer.createdAt ? format(new Date(customer.createdAt), 'MMM d, yyyy') : 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-600">
                          Active
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-sm font-semibold text-[hsl(var(--primary))] hover:underline">
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-[hsl(var(--muted-foreground))]">
                      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                        <Users className="size-6 text-[hsl(var(--muted-foreground))]" />
                      </div>
                      <p className="mt-4 text-sm">No customers found.</p>
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
