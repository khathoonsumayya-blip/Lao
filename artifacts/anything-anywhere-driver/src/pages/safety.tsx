import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  useCreateDriverIssue,
  useListDriverIssues,
  useListDriverIssueConversation,
  useCreateDriverIssueConversationReply,
  DriverIssueInputCategory,
  getListDriverDeliveriesQueryKey,
  getListDriverIssuesQueryKey,
  getListDriverIssueConversationQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, AlertTriangle, PhoneCall, CheckCircle2 } from 'lucide-react';

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? null
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

function issueIdFromLocation(location: string) {
  return new URLSearchParams(location.split('?')[1] ?? '').get('issue') ?? '';
}

export default function Safety() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createIssue = useCreateDriverIssue();
  const createReply = useCreateDriverIssueConversationReply();
  const issues = useListDriverIssues();
  const issueId = issueIdFromLocation(location);
  const selectedIssue = issues.data?.find((issue) => issue.id === issueId);

  const [category, setCategory] = useState<DriverIssueInputCategory>('safety');
  const [message, setMessage] = useState('');
  const [creationError, setCreationError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [replyClientRequestId, setReplyClientRequestId] = useState<string | null>(null);
  const conversation = useListDriverIssueConversation(issueId, {
    query: {
      enabled: Boolean(selectedIssue),
      queryKey: getListDriverIssueConversationQueryKey(issueId),
    },
  });

  const selectIssue = (id: string) => {
    setReply('');
    setReplyClientRequestId(null);
    setLocation(`/safety?issue=${encodeURIComponent(id)}`);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setCreationError(null);
    createIssue.mutate({ data: { category, message: message.trim() } }, {
      onSuccess: (issue) => {
        if (!issue.id) {
          setCreationError('Your report was received, but its conversation could not be opened. Please contact dispatch.');
          return;
        }
        setMessage('');
        queryClient.invalidateQueries({ queryKey: getListDriverIssuesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDriverDeliveriesQueryKey() });
        selectIssue(issue.id);
      },
    });
  };

  const handleReply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedIssue || reply.trim().length < 2 || createReply.isPending) return;

    const clientRequestId = replyClientRequestId ?? crypto.randomUUID();
    setReplyClientRequestId(clientRequestId);
    createReply.mutate({ id: selectedIssue.id, data: { body: reply.trim(), clientRequestId } }, {
      onSuccess: () => {
        setReply('');
        setReplyClientRequestId(null);
        queryClient.invalidateQueries({ queryKey: getListDriverIssueConversationQueryKey(selectedIssue.id) });
      },
    });
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-7">
        <h1 className="font-display text-3xl font-bold uppercase mb-2 text-destructive flex items-center gap-3">
          <ShieldAlert className="w-8 h-8" />
          Safety & Protocol
        </h1>
        <p className="text-muted-foreground">Report critical issues or continue a secure dispatch conversation.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)]">
        <aside className="space-y-4">
          <div className="driver-card p-4" aria-labelledby="reported-issues-heading">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 id="reported-issues-heading" className="font-display text-lg font-bold uppercase">Your reports</h2>
              {issueId && <button type="button" onClick={() => setLocation('/safety')} className="text-xs font-bold underline">New report</button>}
            </div>
            {issues.isLoading && <p role="status" className="text-sm text-muted-foreground" data-testid="status-issues-loading">Loading your reports…</p>}
            {issues.isError && (
              <div role="alert" className="text-sm text-destructive">
                <p>We could not load your reports.</p>
                <button type="button" onClick={() => issues.refetch()} className="underline font-bold mt-2" data-testid="button-retry-issues">Try again</button>
              </div>
            )}
            {!issues.isLoading && !issues.isError && issues.data?.length === 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-issues-empty">You have not submitted any reports.</p>
            )}
            {!issues.isLoading && !issues.isError && Boolean(issues.data?.length) && (
              <div className="space-y-2" data-testid="list-driver-issues">
                {issues.data?.map((issue) => (
                  <button
                    key={issue.id}
                    type="button"
                    onClick={() => selectIssue(issue.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors ${issue.id === issueId ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/50'}`}
                    data-testid={`button-select-issue-${issue.id}`}
                  >
                    <span className="block text-sm font-bold capitalize">{issue.category.replaceAll('_', ' ')}</span>
                    <span className="block mt-1 text-xs text-muted-foreground capitalize">{issue.status.replaceAll('_', ' ')}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="driver-card bg-destructive/10 border-destructive/30 p-5 text-center">
            <AlertTriangle className="w-9 h-9 text-destructive mx-auto mb-3" />
            <h2 className="font-bold uppercase text-destructive mb-2">Emergency Hotline</h2>
            <p className="text-sm text-foreground/80 mb-4">If you are in immediate physical danger, contact local authorities first.</p>
            <button type="button" className="driver-btn bg-destructive text-destructive-foreground w-full h-12 text-sm flex gap-2">
              <PhoneCall className="w-5 h-5" /> Call Dispatch 911
            </button>
          </div>
        </aside>

        <main>
          {issueId && !issues.isLoading && !issues.isError && !selectedIssue && (
            <div role="alert" className="driver-card p-5 text-sm" data-testid="text-issue-not-found">
              This report is not available in your history. Select one of your reports or create a new report.
            </div>
          )}

          {selectedIssue && (
            <section className="driver-card p-4 sm:p-6" aria-labelledby="incident-conversation-heading">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                <div>
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2" />
                  <h2 id="incident-conversation-heading" className="font-display text-xl font-bold uppercase">Incident conversation</h2>
                  <p className="text-sm text-muted-foreground">Continue your secure conversation with dispatch.</p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs font-bold capitalize">{selectedIssue.status.replaceAll('_', ' ')}</span>
              </div>
              {conversation.isLoading && <p role="status" className="text-sm text-muted-foreground" data-testid="status-conversation-loading">Loading conversation…</p>}
              {conversation.isError && (
                <div role="alert" className="rounded-lg bg-destructive/10 text-destructive p-3 text-sm">
                  <p>We could not load this conversation.</p>
                  <button type="button" onClick={() => conversation.refetch()} className="underline font-bold mt-2" data-testid="button-retry-conversation">Try again</button>
                </div>
              )}
              {!conversation.isLoading && !conversation.isError && (
                <div className="space-y-3" data-testid="list-issue-conversation">
                  {conversation.data?.length === 0 && <p className="text-sm text-muted-foreground">No messages yet.</p>}
                  {conversation.data?.map((entry) => {
                    const sentAt = formatTimestamp(entry.createdAt);
                    const isDriver = entry.author.role === 'requester';
                    return <article key={entry.id} className={`rounded-xl p-4 ${isDriver ? 'bg-primary/10 border border-primary/20' : 'bg-secondary/60'}`} data-testid={`message-issue-conversation-${entry.id}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs font-bold uppercase">
                        <span>{entry.origin ? 'Original report' : isDriver ? 'You' : 'Support'}</span>
                        {sentAt && <time dateTime={entry.createdAt} className="text-muted-foreground normal-case font-medium">{sentAt}</time>}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm">{entry.body}</p>
                    </article>;
                  })}
                </div>
              )}
              <form onSubmit={handleReply} className="mt-5 space-y-3">
                <label htmlFor="issue-reply" className="block text-xs font-bold text-muted-foreground uppercase">Add information for dispatch</label>
                <textarea id="issue-reply" value={reply} onChange={(event) => setReply(event.target.value)} minLength={2} maxLength={2000} required disabled={createReply.isPending} className="w-full p-3 text-base min-h-24 resize-none" placeholder="Share an update with support…" data-testid="input-issue-conversation-reply" />
                {createReply.isError && <p role="alert" className="text-sm text-destructive" data-testid="text-issue-reply-error">Your reply was not sent. Try again.</p>}
                <button type="submit" disabled={createReply.isPending || reply.trim().length < 2} className="driver-btn driver-btn-primary w-full sm:w-auto" data-testid="button-send-issue-reply">{createReply.isPending ? 'Sending…' : createReply.isError ? 'Retry reply' : 'Send update'}</button>
              </form>
            </section>
          )}

          {!issueId && (
            <form onSubmit={handleSubmit} className="driver-card p-4 sm:p-6 space-y-6">
              <h2 className="font-display text-xl font-bold uppercase">Submit a report</h2>
              <div>
                <label className="block text-xs font-bold text-muted-foreground uppercase mb-3">Issue Category</label>
                <div className="grid gap-3">
                  {[
                    { id: 'safety', label: 'Safety Concern' }, { id: 'customer_unavailable', label: 'Customer Unavailable' },
                    { id: 'package_damaged', label: 'Package Damaged' }, { id: 'return_package', label: 'Return to Hub Required' },
                    { id: 'delivery_issue', label: 'Other Delivery Issue' },
                  ].map((item) => <label key={item.id} className={`p-4 rounded-xl border flex items-center gap-3 cursor-pointer ${category === item.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'}`}>
                    <input type="radio" name="category" value={item.id} checked={category === item.id} onChange={(event) => setCategory(event.target.value as DriverIssueInputCategory)} className="sr-only" data-testid={`radio-category-${item.id}`} />
                    <span className={`w-5 h-5 rounded-full border-2 ${category === item.id ? 'border-primary bg-primary' : 'border-muted-foreground'}`} />
                    <span className="font-bold text-sm uppercase">{item.label}</span>
                  </label>)}
                </div>
              </div>
              <div>
                <label htmlFor="issue-message" className="block text-xs font-bold text-muted-foreground uppercase mb-2">Incident Details</label>
                <textarea id="issue-message" className="w-full p-4 text-base min-h-[120px] resize-none" placeholder="Describe the situation for dispatch..." value={message} onChange={(event) => setMessage(event.target.value)} required minLength={5} maxLength={2000} data-testid="input-issue-message" />
              </div>
              <button type="submit" disabled={createIssue.isPending || message.trim().length < 5} className="driver-btn driver-btn-primary w-full" data-testid="button-submit-issue">{createIssue.isPending ? 'Transmitting…' : 'Transmit Report'}</button>
              {(createIssue.isError || creationError) && <p role="alert" className="text-sm text-destructive" data-testid="text-issue-create-error">{creationError ?? 'Your report was not sent. Please try again.'}</p>}
            </form>
          )}
        </main>
      </div>
    </div>
  );
}