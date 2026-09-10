import { useState, useMemo } from 'react';
import { useListAdminSupportTickets, useUpdateAdminSupportTicket, useListAdminSupportTicketComments, useCreateAdminSupportTicketComment, getListAdminSupportTicketCommentsQueryKey, useListAdminSupportAgents } from '@workspace/api-client-react';
import type { AdminSupportTicket, AdminSupportTicketPriority, AdminSupportConversationEntrySource } from '@workspace/api-client-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Search, AlertCircle, Clock, CheckCircle2, X, Phone, Mail, User, Package, MessageSquare, Send, RefreshCcw, Loader2 } from 'lucide-react';
import { AdminLayout } from './admin-layout';

type TicketStatus = 'open' | 'in_progress' | 'resolved';

export function AdminSupport() {
  const { data: tickets = [], isLoading, isError, refetch } = useListAdminSupportTickets();
  const [activeTab, setActiveTab] = useState<TicketStatus | 'all'>('open');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // Client-side filtering and search
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const matchesTab = activeTab === 'all' || ticket.status === activeTab;
      if (!matchesTab) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        ticket.reference.toLowerCase().includes(q) ||
        ticket.requester.name.toLowerCase().includes(q) ||
        (ticket.requester.email && ticket.requester.email.toLowerCase().includes(q)) ||
        (ticket.orderNumber && ticket.orderNumber.toLowerCase().includes(q)) ||
        ticket.category.toLowerCase().includes(q) ||
        ticket.source.toLowerCase().includes(q) ||
        ticket.message.toLowerCase().includes(q)
      );
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [tickets, activeTab, searchQuery]);

  const counts = useMemo(() => {
    return tickets.reduce(
      (acc, ticket) => {
        acc[ticket.status] = (acc[ticket.status] || 0) + 1;
        acc.all += 1;
        return acc;
      },
      { open: 0, in_progress: 0, resolved: 0, all: 0 }
    );
  }, [tickets]);

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || null;

  return (
    <AdminLayout>
      <div className="flex h-[calc(100dvh-7rem)] min-h-[600px] flex-col md:h-[calc(100dvh-9rem)]">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Support Desk</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Manage and resolve customer and driver issues.</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="flex items-center justify-center rounded-xl border bg-[hsl(var(--card))] px-3 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
            >
              <RefreshCcw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search tickets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2 pl-9 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-sm">
          {/* List Pane */}
          <div className={`flex flex-col border-r bg-[hsl(var(--card))] transition-all ${selectedTicketId ? 'hidden lg:flex lg:w-1/3 xl:w-2/5' : 'w-full lg:w-1/3 xl:w-2/5'}`}>
            <div className="flex border-b overflow-x-auto">
              {(['open', 'in_progress', 'resolved'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setActiveTab(status)}
                  className={`flex-1 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold capitalize transition-colors ${
                    activeTab === status
                      ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                      : 'border-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  {status.replace('_', ' ')}
                  <span className="ml-2 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs font-medium text-[hsl(var(--foreground))]">
                    {counts[status]}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex h-32 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading tickets...
                </div>
              ) : isError ? (
                <div className="p-6 text-center">
                  <AlertCircle className="mx-auto size-8 text-[hsl(var(--destructive))]" />
                  <p className="mt-2 text-sm font-semibold">Support tickets could not be loaded.</p>
                  <button onClick={() => refetch()} className="mt-3 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))]">Retry</button>
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="flex h-32 flex-col items-center justify-center text-center text-[hsl(var(--muted-foreground))]">
                  <Package className="mb-2 size-8 opacity-20" />
                  <p className="text-sm">No tickets found.</p>
                </div>
              ) : (
                <ul className="divide-y">
                  {filteredTickets.map((ticket) => (
                    <li key={ticket.id}>
                      <button
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className={`w-full p-4 text-left transition-colors hover:bg-[hsl(var(--muted))]/50 ${selectedTicketId === ticket.id ? 'bg-[hsl(var(--primary))]/5' : ''}`}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold">{ticket.reference}</span>
                          <span className="whitespace-nowrap text-xs text-[hsl(var(--muted-foreground))]">
                            {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{ticket.requester.name}</span>
                          <StatusBadge status={ticket.status} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">
                          {ticket.message}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="inline-flex items-center rounded-md bg-[hsl(var(--primary))]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">
                            {ticket.source.replace('_', ' ')}
                          </span>
                          <span className="inline-flex items-center rounded-md bg-[hsl(var(--muted))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                            {ticket.category.replace(/_/g, ' ')}
                          </span>
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${ticket.priority === 'urgent' ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]' : ticket.priority === 'high' ? 'bg-orange-500/10 text-orange-600' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>
                            {ticket.priority}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Detail Pane */}
          {selectedTicketId ? (
            <div className={`flex flex-col bg-[hsl(var(--card))] ${selectedTicketId ? 'flex-1' : 'hidden'}`}>
              {selectedTicket ? (
                <TicketDetail
                  ticket={selectedTicket}
                  onClose={() => setSelectedTicketId(null)}
                  onUpdate={() => refetch()}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
                  Ticket not found.
                </div>
              )}
            </div>
          ) : (
            <div className="hidden flex-1 flex-col items-center justify-center bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))] lg:flex">
              <MessageSquare className="mb-4 size-12 opacity-20" />
              <p>Select a ticket to view details</p>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'open') return <span className="flex items-center gap-1 text-xs font-medium text-orange-600"><AlertCircle className="size-3" /> Open</span>;
  if (status === 'in_progress') return <span className="flex items-center gap-1 text-xs font-medium text-blue-600"><Clock className="size-3" /> In Progress</span>;
  return <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="size-3" /> Resolved</span>;
}

function TicketDetail({ ticket, onClose, onUpdate }: { ticket: AdminSupportTicket; onClose: () => void; onUpdate: () => void }) {
  const update = useUpdateAdminSupportTicket();
  const { data: comments = [], refetch: refetchComments } = useListAdminSupportTicketComments(ticket.id, ticket.source as AdminSupportConversationEntrySource, { query: { enabled: !!ticket.id, queryKey: getListAdminSupportTicketCommentsQueryKey(ticket.id, ticket.source as AdminSupportConversationEntrySource) }});
  const addComment = useCreateAdminSupportTicketComment();
  const { data: agents = [], isLoading: isLoadingAgents } = useListAdminSupportAgents();

  const [resolution, setResolution] = useState(ticket.resolution || '');
  const [newComment, setNewComment] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isCommenting, setIsCommenting] = useState(false);

  const handleStatusUpdate = async (newStatus: 'open' | 'in_progress', priority?: AdminSupportTicketPriority) => {
    setIsUpdating(true);
    try {
      await update.mutateAsync({
        id: ticket.id,
        data: { status: newStatus, source: ticket.source, priority: priority ?? ticket.priority }
      });
      await onUpdate();
    } catch (err) {
      alert('Failed to update ticket. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolution.trim()) {
      alert('Please enter a resolution note before closing this ticket.');
      return;
    }

    if (!confirm('Are you sure you want to resolve this ticket?')) return;

    setIsResolving(true);
    try {
      await update.mutateAsync({
        id: ticket.id,
        data: { status: 'resolved', resolution: resolution.trim(), source: ticket.source }
      });
      await onUpdate();
      setIsResolving(false);
    } catch (err) {
      setIsResolving(false);
      alert('Failed to resolve ticket. Please try again.');
    }
  };

  const handleReopen = async () => {
    if (!confirm('Are you sure you want to reopen this ticket?')) return;

    setIsUpdating(true);
    try {
      await update.mutateAsync({
        id: ticket.id,
        data: { status: 'open', source: ticket.source }
      });
      setResolution('');
      await onUpdate();
    } catch (err) {
      alert('Failed to reopen ticket. Please try again.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    setIsCommenting(true);
    try {
      await addComment.mutateAsync({
        id: ticket.id,
        source: ticket.source as any,
        data: {
          source: ticket.source as any,
          body: newComment.trim(),
          clientRequestId: crypto.randomUUID()
        }
      });
      setNewComment('');
      await refetchComments();
    } catch (err) {
      alert('Failed to post comment. Please try again.');
    } finally {
      setIsCommenting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="rounded-md p-1 hover:bg-[hsl(var(--muted))] lg:hidden">
            <X className="size-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold">{ticket.reference}</h2>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">Created {format(new Date(ticket.createdAt), 'MMM d, yyyy h:mm a')}</p>
          </div>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid gap-6 md:grid-cols-2">

          {/* Left Column: Message, Comments & Resolution */}
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Issue Description</h3>
              <div className="rounded-xl border bg-[hsl(var(--background))] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-[hsl(var(--primary))]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary))]">
                      {ticket.source.replace('_', ' ')}
                    </span>
                    <span className="font-semibold">{ticket.category.replace(/_/g, ' ')}</span>
                  </div>

                  <select
                    value={ticket.priority}
                    onChange={(e) => handleStatusUpdate(ticket.status as any, e.target.value as AdminSupportTicketPriority)}
                    disabled={isUpdating || ticket.status === 'resolved'}
                    className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider border-none outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] ${
                      ticket.priority === 'urgent' ? 'bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]' :
                      ticket.priority === 'high' ? 'bg-orange-500/10 text-orange-600' :
                      'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                    }`}
                  >
                    <option value="low">Low Priority</option>
                    <option value="normal">Normal Priority</option>
                    <option value="high">High Priority</option>
                    <option value="urgent">Urgent Priority</option>
                  </select>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.message}</p>
              </div>
            </section>

            {comments.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Conversation</h3>
                <div className="space-y-4">
                  {comments.map((c: any) => (
                    <div key={c.id} className={`rounded-xl border p-4 ${c.author?.role !== 'customer' && c.author?.role !== 'driver' ? 'bg-[hsl(var(--primary))]/5 border-[hsl(var(--primary))]/20 ml-6' : 'bg-[hsl(var(--background))] mr-6'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <span className="font-bold text-sm">{c.author?.name || 'Unknown'}</span>
                          <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] px-1.5 py-0.5 rounded bg-[hsl(var(--muted))]">{c.author?.role || 'user'}</span>
                          {c.origin && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--primary))] px-1.5 py-0.5 rounded bg-[hsl(var(--primary))]/10 border border-[hsl(var(--primary))]/20">Origin</span>
                          )}
                        </div>
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">{format(new Date(c.createdAt), 'MMM d, h:mm a')}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{c.body}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {ticket.status !== 'resolved' && (
              <section>
                <form onSubmit={handlePostComment} className="flex flex-col gap-2">
                  <textarea
                    rows={2}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Type a reply to the requester..."
                    className="w-full resize-none rounded-lg border bg-[hsl(var(--background))] p-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  />
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={isCommenting || !newComment.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--secondary))] px-4 py-2 text-sm font-bold text-[hsl(var(--secondary-foreground))] shadow-sm hover:brightness-110 disabled:opacity-50"
                    >
                      {isCommenting ? 'Sending...' : <><Send className="size-4" /> Reply</>}
                    </button>
                  </div>
                </form>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Resolution</h3>
              {ticket.status === 'resolved' ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/30 dark:bg-emerald-900/10">
                  <p className="mb-2 text-sm font-medium text-emerald-800 dark:text-emerald-300">
                    Resolved by {ticket.resolvedBy?.name || 'Staff'} on {ticket.resolvedAt ? format(new Date(ticket.resolvedAt), 'MMM d, yyyy') : 'Unknown'}
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-emerald-700 dark:text-emerald-400">{ticket.resolution}</p>

                  <button
                    onClick={handleReopen}
                    disabled={isUpdating}
                    className="mt-4 rounded-lg bg-[hsl(var(--background))] px-4 py-2 text-sm font-semibold text-[hsl(var(--foreground))] shadow-sm border transition hover:bg-[hsl(var(--muted))] disabled:opacity-50"
                  >
                    {isUpdating ? 'Reopening...' : 'Reopen Ticket'}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleResolve} className="rounded-xl border bg-[hsl(var(--background))] p-4">
                  {ticket.status === 'open' && (
                    <div className="mb-4 flex flex-col justify-between gap-3 rounded-lg bg-[hsl(var(--primary))]/5 p-3 sm:flex-row sm:items-center">
                      <span className="text-sm font-medium text-[hsl(var(--primary))]">Ticket is currently Open</span>
                      <button
                        type="button"
                        onClick={() => handleStatusUpdate('in_progress')}
                        disabled={isUpdating || isResolving}
                        className="rounded bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))] shadow-sm transition hover:brightness-110 disabled:opacity-50"
                      >
                        {isUpdating ? 'Updating...' : 'Start Progress'}
                      </button>
                    </div>
                  )}
                  {ticket.status === 'in_progress' && (
                    <div className="mb-4 flex flex-col justify-between gap-3 rounded-lg bg-blue-500/5 p-3 sm:flex-row sm:items-center">
                      <span className="text-sm font-medium text-blue-600 dark:text-blue-400">Ticket is In Progress</span>
                      <button
                        type="button"
                        onClick={() => handleStatusUpdate('open')}
                        disabled={isUpdating || isResolving}
                        className="rounded border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:bg-blue-950 dark:hover:bg-blue-900"
                      >
                        {isUpdating ? 'Updating...' : 'Return to Open'}
                      </button>
                    </div>
                  )}
                  <label htmlFor="resolution" className="mb-2 block text-sm font-medium">Resolution Notes</label>
                  <textarea
                    id="resolution"
                    required
                    rows={3}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="Describe how this issue was resolved..."
                    className="w-full resize-none rounded-lg border bg-[hsl(var(--background))] p-3 text-sm focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="submit"
                      disabled={isResolving || !resolution.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-sm transition hover:brightness-110 disabled:opacity-50"
                    >
                      {isResolving ? 'Resolving...' : <><CheckCircle2 className="size-4" /> Resolve Ticket</>}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </div>

          {/* Right Column: Requester & Context */}
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Assignment</h3>
              <div className="rounded-xl border bg-[hsl(var(--background))] p-4">
                <label htmlFor="agent-select" className="mb-2 block text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Assign to Agent</label>
                <div className="flex gap-2">
                  <select
                    id="agent-select"
                    value={(ticket as any).assignedProfileId || ''}
                    onChange={(e) => {
                      setIsUpdating(true);
                      update.mutateAsync({
                        id: ticket.id,
                        data: {
                          source: ticket.source,
                          assignedProfileId: e.target.value || undefined,
                        }
                      }).then(() => onUpdate()).catch(() => alert('Failed to assign ticket.')).finally(() => setIsUpdating(false));
                    }}
                    disabled={isUpdating || isLoadingAgents || ticket.status === 'resolved'}
                    className="w-full rounded-lg border bg-[hsl(var(--background))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] disabled:opacity-50"
                  >
                    <option value="">Unassigned</option>
                    {agents.map((agent: any) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.firstName ? `${agent.firstName} ${agent.lastName}` : (agent.name || agent.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Requester Details</h3>
              <div className="rounded-xl border bg-[hsl(var(--background))] p-4">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                    <User className="size-5" />
                  </div>
                  <div>
                    <p className="font-bold">{ticket.requester.name}</p>
                    <p className="text-xs font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{ticket.requester.role}</p>
                  </div>
                </div>

                <dl className="space-y-3 text-sm">
                  {ticket.requester.email && (
                    <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))]">
                      <Mail className="size-4" />
                      <a href={`mailto:${ticket.requester.email}`} className="font-medium text-[hsl(var(--foreground))] hover:underline">{ticket.requester.email}</a>
                    </div>
                  )}
                  {ticket.requester.phone && (
                    <div className="flex items-center gap-3 text-[hsl(var(--muted-foreground))]">
                      <Phone className="size-4" />
                      <a href={`tel:${ticket.requester.phone}`} className="font-medium text-[hsl(var(--foreground))] hover:underline">{ticket.requester.phone}</a>
                    </div>
                  )}
                </dl>
              </div>
            </section>

            {(ticket.orderNumber || ticket.deliveryId) && (
              <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Related Delivery</h3>
                <div className="rounded-xl border bg-[hsl(var(--background))] p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]">
                      <Package className="size-5" />
                    </div>
                    <div>
                      {ticket.orderNumber ? (
                        <p className="font-bold">{ticket.orderNumber}</p>
                      ) : (
                        <p className="font-bold">Delivery Record</p>
                      )}
                      <p className="text-xs font-medium text-[hsl(var(--muted-foreground))]">ID: {ticket.deliveryId || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
