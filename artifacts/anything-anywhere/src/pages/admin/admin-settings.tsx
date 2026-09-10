import { useGetAdminSettings } from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { Settings } from 'lucide-react';

export function AdminSettings() {
  const { isLoading } = useGetAdminSettings();

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Settings</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Configure global platform parameters and pricing rules.</p>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <div className="h-64 animate-pulse rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"></div>
            <div className="h-64 animate-pulse rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
              <div className="border-b border-[hsl(var(--border))] px-6 py-4">
                <h2 className="font-bold text-[hsl(var(--foreground))]">Pricing Model</h2>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Base rates and distance multipliers.</p>
              </div>
              <div className="p-6 space-y-4">
                <p className="rounded-xl bg-[hsl(var(--muted))]/60 px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
                  This is a protected operating snapshot. Pricing changes require an approved configuration release and are not editable from the desk.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Base Fare (Cents)</span>
                    <input type="number" value="500" readOnly className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--muted))]/40 px-4 py-2.5 text-sm text-[hsl(var(--muted-foreground))]" />
                  </label>
                  <label className="block">
                    <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Per Mile (Cents)</span>
                    <input type="number" value="150" readOnly className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--muted))]/40 px-4 py-2.5 text-sm text-[hsl(var(--muted-foreground))]" />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
              <div className="border-b border-[hsl(var(--border))] px-6 py-4">
                <h2 className="font-bold text-[hsl(var(--foreground))]">Delivery Zones</h2>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Active operating regions.</p>
              </div>
              <div className="p-6">
                <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4">
                  <div className="flex items-center justify-between border-b border-[hsl(var(--border))] pb-3">
                    <div>
                      <h3 className="font-semibold text-[hsl(var(--foreground))]">Raleigh / Triangle</h3>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">Primary operating zone</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">Active</span>
                  </div>
                  <div className="pt-3 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-[hsl(var(--foreground))]">Charlotte</h3>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">Expansion zone</p>
                    </div>
                    <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Disabled</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </AdminLayout>
  );
}
