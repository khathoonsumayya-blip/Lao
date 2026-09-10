import { useGetDriverBonusWallet } from '@workspace/api-client-react';
import { Clock, RefreshCw, Star } from 'lucide-react';

const money = (cents: number) => (cents / 100).toFixed(2);

export default function Rewards() {
  const wallet = useGetDriverBonusWallet();
  if (wallet.isLoading) return <div className="p-6" role="status">Loading rewards and bonuses…</div>;
  if (wallet.isError || !wallet.data) return <div className="p-6 pt-12 text-center" role="alert"><div className="driver-card p-6"><p className="font-bold">Rewards are temporarily unavailable.</p><button type="button" onClick={() => wallet.refetch()} className="driver-btn driver-btn-primary mt-5 w-full"><RefreshCw className="size-4" />Try again</button></div></div>;

  const totals = [
    ['Paid / Available', wallet.data.paidCents, 'text-emerald-500'],
    ['Approved', wallet.data.approvedCents, 'text-foreground'],
    ['Pending', wallet.data.pendingCents, 'text-primary'],
    ['Reversed', wallet.data.reversedCents, 'text-destructive'],
  ] as const;
  return <div className="p-6">
    <div className="mb-7"><h1 className="flex items-center gap-3 font-display text-3xl font-bold uppercase"><Star className="size-8 text-primary" />Rewards & Bonuses</h1><p className="mt-2 text-muted-foreground">Track every performance reward and its payment status.</p></div>
    <div className="mb-8 grid grid-cols-2 gap-3">{totals.map(([label, cents, color]) => <div key={label} className="driver-card p-4"><p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p><p className={`mt-2 font-display text-2xl font-bold ${color}`}>${money(cents)}</p></div>)}</div>
    <h2 className="mb-4 font-display text-xl font-bold uppercase">Bonus activity</h2>
    <div className="space-y-3">{wallet.data.transactions.length ? wallet.data.transactions.map((transaction) => <article key={transaction.id} className="driver-ticket p-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-bold capitalize">{transaction.type.replaceAll('_', ' ')}</h3><p className="mt-1 text-sm text-muted-foreground">{transaction.reason}</p></div><p className={`shrink-0 font-bold ${transaction.status === 'reversed' ? 'text-destructive line-through' : 'text-emerald-500'}`}>${money(transaction.amountCents)}</p></div>
      <p className="mt-3 flex items-center gap-1 text-xs capitalize text-muted-foreground"><Clock className="size-3" />{transaction.status} · {new Date(transaction.createdAt).toLocaleDateString()}</p>
    </article>) : <div className="driver-card p-6 text-center text-muted-foreground">No rewards have been awarded yet. New bonuses will appear here automatically.</div>}</div>
  </div>;
}