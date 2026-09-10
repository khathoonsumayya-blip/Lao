import { useGetAdminIntegrationHealth } from '@workspace/api-client-react';
import { Loader2, AlertCircle, RefreshCcw, Link2, CheckCircle2, XCircle, Settings, HelpCircle, DollarSign, Mail, Database, Server, Code } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function IntegrationsSettings() {
  const { data, isLoading, isError, refetch, isFetching } = useGetAdminIntegrationHealth();

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  if (isError || !data) return (
    <div className="flex flex-col items-center p-10">
      <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
      <p className="font-semibold">Failed to load integration health.</p>
      <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
    </div>
  );

  const IntegrationsList = [
    { key: 'googleMaps', name: 'Google Maps API', desc: 'Used for geocoding, route calculations, and maps.', icon: <Settings className="w-4 h-4" /> },
    { key: 'stripe', name: 'Stripe Payments', desc: 'Handles credit card processing and driver payouts.', icon: <DollarSign className="w-4 h-4" /> },
    { key: 'resend', name: 'Resend Email', desc: 'Sends automated transactional emails to users.', icon: <Mail className="w-4 h-4" /> },
    { key: 'storage', name: 'Cloud Storage', desc: 'Stores driver documents and delivery photos.', icon: <Database className="w-4 h-4" /> },
    { key: 'database', name: 'Primary Database', desc: 'Core Postgres SQL transactional database.', icon: <Server className="w-4 h-4" /> },
    { key: 'api', name: 'Internal API', desc: 'Core business logic and validation layer.', icon: <Code className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Integrations & Health</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Real-time status of third-party services and internal infrastructure.</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-semibold hover:bg-[hsl(var(--secondary))]/80 transition disabled:opacity-50"
        >
          <RefreshCcw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-[hsl(var(--primary))]" />
          <h3 className="font-semibold">Connected Services</h3>
        </div>
        
        <div className="divide-y">
          {IntegrationsList.map(({ key, name, desc, icon }) => {
            const health = data[key as keyof typeof data] as any;
            if (!health) return null;

            return (
              <div key={key} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center shrink-0">
                    {icon}
                  </div>
                  <div>
                    <h4 className="font-bold flex items-center gap-2">
                      {name}
                      {!health.configured && (
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="w-4 h-4 text-[hsl(var(--muted-foreground))]" />
                          </TooltipTrigger>
                          <TooltipContent>Missing required environment variables.</TooltipContent>
                        </Tooltip>
                      )}
                    </h4>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">{desc}</p>
                    <div className="text-xs text-[hsl(var(--muted-foreground))] mt-2 flex gap-4">
                      <span>Last checked: {new Date(health.lastCheckedAt).toLocaleTimeString()}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-start md:self-auto shrink-0 bg-[hsl(var(--muted))]/30 px-4 py-2 rounded-lg border">
                  {health.configured ? (
                    health.healthy ? (
                      <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium text-sm">
                        <CheckCircle2 className="w-4 h-4" /> Healthy & Connected
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-medium text-sm">
                        <XCircle className="w-4 h-4" /> Connection Failing
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-2 text-[hsl(var(--muted-foreground))] font-medium text-sm">
                      <AlertCircle className="w-4 h-4" /> Not Configured
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

