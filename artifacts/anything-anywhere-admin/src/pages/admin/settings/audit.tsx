import { useState, useMemo } from 'react';
import { useListAdminAuditLogs } from '@workspace/api-client-react';
import { Loader2, AlertCircle, RefreshCcw, Search, ShieldAlert, FilterX } from 'lucide-react';

export function AuditLogSettings() {
  const { data: logs, isLoading, isError, refetch } = useListAdminAuditLogs();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [filterAction, setFilterAction] = useState('all');

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    
    return logs.filter(log => {
      // Action filter
      if (filterAction !== 'all' && log.action !== filterAction) {
        return false;
      }
      
      // Text search
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const searchable = [
          log.actorName || '',
          log.entityLabel || '',
          log.action,
          log.entityType,
          log.driverName || ''
        ].join(' ').toLowerCase();
        
        if (!searchable.includes(term)) {
          return false;
        }
      }
      
      return true;
    });
  }, [logs, searchTerm, filterAction]);

  // Extract unique actions for the filter dropdown
  const uniqueActions = useMemo(() => {
    if (!logs) return [];
    const actions = new Set(logs.map(l => l.action));
    return Array.from(actions).sort();
  }, [logs]);

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  if (isError || !logs) return (
    <div className="flex flex-col items-center p-10">
      <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
      <p className="font-semibold">Failed to load audit logs.</p>
      <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Audit Log</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Review administrative actions and system events.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-semibold hover:bg-[hsl(var(--secondary))]/80 transition"
        >
          <RefreshCcw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b bg-[hsl(var(--muted))]/30 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
            <input
              type="text"
              placeholder="Search actor, entity, or action..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border rounded-lg bg-[hsl(var(--background))]"
            />
          </div>
          <div className="shrink-0">
            <select
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
              className="w-full sm:w-auto pl-3 pr-8 py-2 text-sm border rounded-lg bg-[hsl(var(--background))]"
            >
              <option value="all">All Actions</option>
              {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))]/20 uppercase">
              <tr>
                <th className="px-6 py-3 font-semibold">Timestamp</th>
                <th className="px-6 py-3 font-semibold">Actor</th>
                <th className="px-6 py-3 font-semibold">Action</th>
                <th className="px-6 py-3 font-semibold">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-[hsl(var(--muted-foreground))]">
                    <div className="flex flex-col items-center gap-2">
                      <FilterX className="w-8 h-8 opacity-20" />
                      <p>No audit logs match your search.</p>
                      {(searchTerm || filterAction !== 'all') && (
                        <button 
                          onClick={() => { setSearchTerm(''); setFilterAction('all'); }}
                          className="text-[hsl(var(--primary))] font-medium hover:underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map(log => (
                  <tr key={log.id} className="hover:bg-[hsl(var(--muted))]/10">
                    <td className="px-6 py-4 whitespace-nowrap text-[hsl(var(--muted-foreground))]">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 font-medium">
                      {log.actorName || <span className="text-[hsl(var(--muted-foreground))]/50 italic">System</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <span className="font-semibold">{log.entityType}</span>
                        {log.entityLabel && <span className="ml-2 text-[hsl(var(--muted-foreground))]">{log.entityLabel}</span>}
                      </div>
                      {log.driverName && (
                        <div className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5">
                          Driver: {log.driverName}
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
