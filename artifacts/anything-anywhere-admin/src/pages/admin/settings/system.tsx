import { useGetAdminSystemStatus } from '@workspace/api-client-react';
import { Loader2, AlertCircle, Server, Activity, RefreshCcw, Database, Code, Clock } from 'lucide-react';

export function SystemStatusSettings() {
  const { data, isLoading, isError, refetch, isFetching } = useGetAdminSystemStatus();

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  if (isError || !data) return (
    <div className="flex flex-col items-center p-10">
      <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
      <p className="font-semibold">Failed to load system status.</p>
      <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
    </div>
  );

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600*24));
    const h = Math.floor(seconds % (3600*24) / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">System Status</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Internal infrastructure and database health metrics.</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-semibold hover:bg-[hsl(var(--secondary))]/80 transition disabled:opacity-50"
        >
          <RefreshCcw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh Metrics
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-3">
        <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Code className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold">API Server</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Core backend service</p>
            </div>
          </div>
          <div className="mt-auto">
            {data.api === 'healthy' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Operational
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                Unavailable
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold">Database</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Postgres storage</p>
            </div>
          </div>
          <div className="mt-auto">
            {data.database === 'healthy' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Operational
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                Degraded
              </span>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))]">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold">Uptime</h3>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Continuous operation</p>
            </div>
          </div>
          <div className="mt-auto text-xl font-mono font-bold text-[hsl(var(--primary))]">
            {formatUptime(data.uptimeSeconds)}
          </div>
        </div>
      </div>

      <div className="text-xs text-[hsl(var(--muted-foreground))] flex items-center gap-2">
        <Activity className="w-3 h-3" />
        Last automated check: {new Date(data.checkedAt).toLocaleString()}
      </div>
    </div>
  );
}
