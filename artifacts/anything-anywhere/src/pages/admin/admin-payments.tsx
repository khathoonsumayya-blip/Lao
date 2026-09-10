import { useState } from 'react';
import { useListAdminPayments, useRequestAdminPaymentRefund } from '@workspace/api-client-react';
import { CreditCard, RefreshCcw } from 'lucide-react';
import { format } from 'date-fns';
import { AdminLayout } from './admin-layout';

type PaymentRecord = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  orderNumber: string;
  customerName: string;
  createdAt: string;
};

export function AdminPayments() {
  const { data, isLoading, refetch } = useListAdminPayments();
  const payments = (data ?? []) as PaymentRecord[];
  const [reason, setReason] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const refund = useRequestAdminPaymentRefund();

  const requestRefund = async (id: string) => {
    const value = reason[id]?.trim() ?? '';
    if (value.length < 3) {
      setMessage('Add a brief refund reason before submitting the request.');
      return;
    }
    setMessage('');
    try {
      await refund.mutateAsync({ id, data: { reason: value } });
      setMessage('Refund request recorded. Stripe confirmation is tracked by webhook.');
      await refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Refund request could not be recorded.');
    }
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--primary))]">Financial operations</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">Payments & revenue</h1>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Review payment records and request durable, webhook-confirmed Stripe refunds.</p>
        </div>
        {message && <p className="rounded-xl bg-[hsl(var(--muted))] px-4 py-3 text-sm text-[hsl(var(--foreground))]">{message}</p>}
        <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]/50 text-[hsl(var(--muted-foreground))]">
                <tr><th className="px-6 py-4 font-semibold">Delivery</th><th className="px-6 py-4 font-semibold">Customer</th><th className="px-6 py-4 font-semibold">Amount</th><th className="px-6 py-4 font-semibold">Status</th><th className="px-6 py-4 font-semibold">Received</th><th className="px-6 py-4 font-semibold">Refund</th></tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border))]">
                {isLoading ? Array.from({ length: 5 }, (_, index) => <tr key={index} className="animate-pulse"><td colSpan={6} className="px-6 py-5"><div className="h-4 w-full rounded bg-[hsl(var(--muted))]" /></td></tr>) :
                  payments.length ? payments.map((payment) => (
                    <tr key={payment.id} className="hover:bg-[hsl(var(--muted))]/30">
                      <td className="px-6 py-4 font-mono text-xs font-semibold text-[hsl(var(--primary))]">{payment.orderNumber}</td>
                      <td className="px-6 py-4">{payment.customerName}</td>
                      <td className="px-6 py-4 font-bold">${payment.amount.toFixed(2)} <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{payment.currency}</span></td>
                      <td className="px-6 py-4"><span className="rounded-full bg-[hsl(var(--muted))] px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{payment.status}</span></td>
                      <td className="px-6 py-4 text-[hsl(var(--muted-foreground))]">{format(new Date(payment.createdAt), 'MMM d, h:mm a')}</td>
                      <td className="px-6 py-4">{payment.status === 'paid' ? <div className="flex gap-2"><input value={reason[payment.id] ?? ''} onChange={(event) => setReason((current) => ({ ...current, [payment.id]: event.target.value }))} placeholder="Reason" className="w-28 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs" /><button onClick={() => requestRefund(payment.id)} disabled={refund.isPending} className="inline-flex items-center gap-1 rounded-lg border border-[hsl(var(--border))] px-2 py-1.5 text-xs font-bold hover:bg-[hsl(var(--muted))]" data-testid={`button-refund-${payment.id}`}><RefreshCcw className="size-3" />Refund</button></div> : <span className="text-xs text-[hsl(var(--muted-foreground))]">No action</span>}</td>
                    </tr>
                  )) : <tr><td colSpan={6} className="px-6 py-14 text-center text-[hsl(var(--muted-foreground))]"><CreditCard className="mx-auto mb-3 size-7" />No payment records are available.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}