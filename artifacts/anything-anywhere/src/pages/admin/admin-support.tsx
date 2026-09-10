import { useState } from 'react';
import { useListAdminSupportTickets, useUpdateAdminSupportTicket } from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { LifeBuoy, Search, MessageSquare, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

export function AdminSupport() {
  const { data: tickets, isLoading, refetch } = useListAdminSupportTickets();
  const [search, setSearch] = useState('');
  const updateMutation = useUpdateAdminSupportTicket();

  const typedTickets = (tickets as any[]) || [];
  const filtered = typedTickets.filter(t => 
    (t.subject && t.subject.toLowerCase().includes(search.toLowerCase())) ||
    (t.id && t.id.toLowerCase().includes(search.toLowerCase()))
  );

  const handleResolve = async (ticketId: string) => {
    try {
      await updateMutation.mutateAsync({ id: ticketId, data: { status: 'resolved' } });
      refetch();
    } catch (e) {
      console.error(e);
      alert('Failed to resolve ticket');
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Support Tickets</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Manage customer and driver issues.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search subject or ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-9 py-2 text-sm text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"></div>
            ))
          ) : filtered.length > 0 ? (
            filtered.map((ticket, idx) => (
              <div key={ticket.id || idx} className="flex flex-col gap-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-4">
                  <div className={`mt-1 flex size-10 shrink-0 items-center justify-center rounded-xl ${ticket.status === 'open' ? 'bg-orange-500/10 text-orange-600' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>
                    {ticket.status === 'open' ? <AlertCircle className="size-5" /> : <MessageSquare className="size-5" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-[hsl(var(--foreground))]">{ticket.subject || 'Support Request'}</h3>
                      <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                        #{ticket.id?.slice(0, 8) || 'N/A'}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
                      {ticket.description || 'No description provided.'}
                    </p>
                    <div className="mt-2 flex items-center gap-4 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                      <span>{ticket.createdAt ? format(new Date(ticket.createdAt), 'MMM d, yyyy h:mm a') : 'Unknown date'}</span>
                      <span className="uppercase text-[hsl(var(--primary))]">{ticket.status || 'open'}</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex shrink-0 gap-2 sm:flex-col sm:items-end">
                  <button className="flex-1 rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-xs font-bold transition-colors hover:bg-[hsl(var(--muted))] sm:flex-none">
                    View Thread
                  </button>
                  {ticket.status !== 'resolved' && (
                    <button 
                      onClick={() => handleResolve(ticket.id)}
                      disabled={updateMutation.isPending}
                      className="flex-1 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50 sm:flex-none"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-12 text-center text-[hsl(var(--muted-foreground))]">
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--muted))]">
                <LifeBuoy className="size-6 text-[hsl(var(--muted-foreground))]" />
              </div>
              <p>No support tickets found.</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
