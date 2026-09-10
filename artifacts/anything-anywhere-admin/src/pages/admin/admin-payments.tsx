import { useState, useMemo } from 'react';
import { useListAdminPayments, useRequestAdminPaymentRefund, useGetAdminPaymentsSummary } from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { Loader2, AlertCircle, RefreshCcw, DollarSign, CreditCard, Receipt } from 'lucide-react';
import { format } from 'date-fns';

export function AdminPayments() {
  const { data: payments = [], isLoading, isError, refetch } = useListAdminPayments();
  const { data: summary, isLoading: isLoadingSummary, isError: isErrorSummary } = useGetAdminPaymentsSummary();
  const refund = useRequestAdminPaymentRefund();
  const [reason, setReason] = useState<Record<string, string>>({});

  const handleRefundRequest = async (id: string) => {
    const refundReason = (reason[id] || '').trim();
    if (refundReason.length < 3) {
      alert('Please provide a brief reason for this refund request.');
      return;
    }

    if (!confirm('Are you sure you want to request a refund for this payment?')) return;

    try {
      await refund.mutateAsync({ id, data: { reason: refundReason } });
      await refetch();
      setReason(prev => ({ ...prev, [id]: '' }));
    } catch (e) {
      alert('The refund request could not be saved. Please try again.');
    }
  };

  const revenueSummary = useMemo(() => {
    if (summary) {
      return {
        total: summary.grossPaidRevenue,
        count: summary.paidCount,
        refunded: summary.refundedAmount,
        refundedCount: summary.refundedCount,
        platformRevenue: summary.platformRevenue
      };
    }
    // Fallback while loading
    return { total: 0, count: 0, refunded: 0, refundedCount: 0, platformRevenue: 0 };
  }, [summary]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Payments & Revenue</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Review payment records and request refunds.</p>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isLoading || refund.isPending}
            className="flex items-center gap-2 rounded-lg border bg-[hsl(var(--card))] px-4 py-2 text-sm font-semibold hover:bg-[hsl(var(--muted))] disabled:opacity-50"
          >
            <RefreshCcw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {!isLoadingSummary && !isErrorSummary && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
                  <DollarSign className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">Gross Revenue</p>
                  <p className="text-2xl font-bold">${revenueSummary.total.toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] dark:bg-[hsl(var(--primary))]/20 dark:text-[hsl(var(--primary))]">
                  <DollarSign className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">Platform Revenue</p>
                  <p className="text-2xl font-bold">${revenueSummary.platformRevenue.toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                  <CreditCard className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">Refunded Value</p>
                  <p className="text-2xl font-bold">${revenueSummary.refunded.toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border bg-[hsl(var(--card))] p-6 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex size-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                  <AlertCircle className="size-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">Refunds</p>
                  <p className="text-2xl font-bold">{revenueSummary.refundedCount}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-sm">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center p-12 text-[hsl(var(--muted-foreground))]">
              <Loader2 className="mb-4 size-8 animate-spin text-[hsl(var(--primary))]" />
              <p>Loading payments...</p>
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <AlertCircle className="mb-4 size-10 text-[hsl(var(--destructive))]" />
              <p className="font-semibold">Failed to load payments.</p>
              <button onClick={() => refetch()} className="mt-4 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-white font-semibold shadow-sm">Retry</button>
            </div>
          ) : payments.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-[hsl(var(--muted-foreground))]">
              <Receipt className="mb-4 size-12 opacity-20" />
              <p>No payment records found.</p>
            </div>
          ) : (
            <div className="divide-y">
              {payments.map((payment) => (
                <div key={payment.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 transition-colors hover:bg-[hsl(var(--muted))]/30">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <p className="font-mono text-sm font-bold text-[hsl(var(--primary))]">{payment.orderNumber}</p>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        payment.status === 'paid' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' :
                        payment.status.includes('refund') ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                        'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'
                      }`}>
                        {payment.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))] px-2 py-0.5 rounded border">
                        {payment.provider}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] block">Amount</span>
                        <span className="font-semibold">${Number(payment.amount).toFixed(2)} {payment.currency.toUpperCase()}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] block">Customer</span>
                        <span className="font-medium">{payment.customerName}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] block">Date</span>
                        <span className="font-medium text-[hsl(var(--muted-foreground))]">{format(new Date(payment.createdAt), 'MMM d, yyyy h:mm a')}</span>
                      </div>
                    </div>

                    {payment.refund && (
                      <div className="mt-2 rounded-lg bg-orange-50 border border-orange-200 p-3 text-sm dark:bg-orange-950/20 dark:border-orange-900/30">
                        <div className="flex items-center gap-2 text-orange-800 dark:text-orange-300">
                          <AlertCircle className="size-4" />
                          <span className="font-semibold">Refund {payment.refund.status}</span>
                        </div>
                        <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">
                          Requested {format(new Date(payment.refund.createdAt), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                    )}
                  </div>

                  {payment.status === 'paid' && !payment.refund && (
                    <div className="flex w-full md:w-auto shrink-0 flex-col gap-2 rounded-xl border bg-[hsl(var(--background))] p-3">
                      <input
                        value={reason[payment.id] || ''}
                        onChange={(event) => setReason({ ...reason, [payment.id]: event.target.value })}
                        className="w-full rounded-md border bg-[hsl(var(--background))] px-3 py-1.5 text-sm outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                        placeholder="Reason for refund..."
                        disabled={refund.isPending}
                      />
                      <button
                        disabled={refund.isPending || !reason[payment.id]?.trim()}
                        onClick={() => handleRefundRequest(payment.id)}
                        className="w-full rounded-md bg-orange-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-50"
                      >
                        Request Refund
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
