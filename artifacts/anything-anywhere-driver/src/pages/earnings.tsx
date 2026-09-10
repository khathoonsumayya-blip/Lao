import { useGetDriverEarnings, useGetDriverBonusWallet } from '@workspace/api-client-react';
import type { DriverEarning, DriverBonusWalletTransactionsItem } from '@workspace/api-client-react';
import { Wallet, TrendingUp, Calendar, Clock, DollarSign, Star } from 'lucide-react';
import { format } from 'date-fns';

const money = (value: number | null | undefined) => Number(value || 0).toFixed(2);
const dateTime = (value: string | null | undefined) => value && !Number.isNaN(new Date(value).getTime()) ? format(new Date(value), 'MMM d, HH:mm') : 'Date unavailable';
const shortDate = (value: string | null | undefined) => value && !Number.isNaN(new Date(value).getTime()) ? format(new Date(value), 'MMM d') : '?';

type ActivityItem =
  | { kind: 'earning', data: DriverEarning, date: Date, id: string }
  | { kind: 'bonus', data: DriverBonusWalletTransactionsItem, date: Date, id: string };

export default function Earnings() {
  const { data: earnings, isLoading: isLoadingEarnings, isError: isErrorEarnings, refetch: refetchEarnings } = useGetDriverEarnings();
  const { data: bonusWallet, isLoading: isLoadingBonus, isError: isErrorBonus, refetch: refetchBonus } = useGetDriverBonusWallet();

  const isLoading = isLoadingEarnings || isLoadingBonus;
  const isError = isErrorEarnings || isErrorBonus;

  if (isLoading) {
    return <div className="space-y-4 p-6" role="status" aria-label="Loading earnings">
      <div className="driver-skeleton h-20 rounded-2xl" />
      <div className="driver-skeleton h-36 rounded-[20px]" />
      <div className="grid grid-cols-2 gap-4"><div className="driver-skeleton h-24 rounded-[20px]" /><div className="driver-skeleton h-24 rounded-[20px]" /></div>
    </div>;
  }
  if (isError || !earnings || !bonusWallet) {
    return <div className="p-6 pt-14 text-center" role="alert">
      <div className="driver-card mx-auto max-w-sm p-7">
        <h1 className="font-display text-2xl font-bold uppercase">Earnings are taking a moment</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Your delivery earnings are still safe. Try refreshing this screen in a moment.</p>
        <button type="button" onClick={() => { refetchEarnings(); refetchBonus(); }} className="driver-btn driver-btn-primary mt-6 w-full h-12 text-sm">Try again</button>
      </div>
    </div>;
  }

  const activity: ActivityItem[] = [
    ...(earnings.recent || []).map(tx => ({ kind: 'earning' as const, data: tx, date: new Date(tx.createdAt), id: `earning-${tx.id}` })),
    ...(bonusWallet.transactions || []).map(tx => ({ kind: 'bonus' as const, data: tx, date: new Date(tx.createdAt), id: `bonus-${tx.id}` }))
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <div className="p-6 pb-24">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold uppercase mb-2">Earnings Ledger</h1>
        <p className="text-muted-foreground">See your delivery earnings and payout progress.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="driver-card p-5 col-span-2 bg-primary !text-white border-none">
          <div className="flex justify-between items-start mb-2">
            <div className="font-mono text-xs font-bold uppercase tracking-widest opacity-80">Today's Total</div>
            <Wallet className="w-5 h-5 opacity-80" />
          </div>
          <div className="font-display text-5xl font-bold">${money(earnings.today)}</div>
        </div>

        <div className="driver-card p-4">
          <div className="flex justify-between items-start mb-2">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">This Week</div>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="font-display text-2xl font-bold text-foreground">${money(earnings.week)}</div>
        </div>

        <div className="driver-card p-4">
          <div className="flex justify-between items-start mb-2">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">This Month</div>
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="font-display text-2xl font-bold text-foreground">${money(earnings.month)}</div>
        </div>
      </div>

      <div className="driver-card p-5 mb-8">
        <h2 className="font-display text-lg font-bold uppercase mb-4">Bonus Wallet</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-secondary/30 rounded-xl border border-border">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Paid / Avail</div>
            <div className="font-display text-xl font-bold text-emerald-500">${money(bonusWallet.paidCents / 100)}</div>
          </div>
          <div className="p-3 bg-secondary/30 rounded-xl border border-border">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Approved</div>
            <div className="font-display text-xl font-bold text-foreground">${money(bonusWallet.approvedCents / 100)}</div>
          </div>
          <div className="p-3 bg-secondary/30 rounded-xl border border-border">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Pending</div>
            <div className="font-display text-xl font-bold text-muted-foreground">${money(bonusWallet.pendingCents / 100)}</div>
          </div>
          <div className="p-3 bg-secondary/30 rounded-xl border border-border">
            <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Reversed</div>
            <div className="font-display text-xl font-bold text-destructive">${money(bonusWallet.reversedCents / 100)}</div>
          </div>
        </div>
      </div>

      <div className="driver-card p-5 mb-8">
        <div className="flex justify-between items-center mb-4 pb-4 border-b border-border">
          <span className="font-mono text-xs font-bold uppercase text-muted-foreground">Payout Status</span>
          <span className={`font-bold text-sm uppercase ${earnings.payoutStatus === 'processing' ? 'text-primary' : 'text-emerald-500'}`}>
            {earnings.payoutStatus}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-mono text-xs font-bold uppercase text-muted-foreground">Bonuses & Adjustments</span>
           <span className="font-bold text-sm text-foreground">+${money(Number(earnings.bonuses || 0) + Number(earnings.adjustments || 0))}</span>
        </div>
      </div>

      <div>
        <h2 className="font-display text-xl font-bold uppercase mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {activity.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground font-mono text-sm uppercase border border-dashed border-border rounded-xl">
              No recent transactions
            </div>
          ) : (
            activity.map(item => {
              if (item.kind === 'earning') {
                const tx = item.data;
                return (
                  <div key={item.id} className="driver-ticket p-4 flex justify-between items-center" data-testid={`tx-${tx.id}`}>
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-foreground shrink-0">
                        <DollarSign className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sm truncate">Delivery {tx.orderNumber}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3 shrink-0" />
                           {dateTime(tx.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 pl-2">
                       <div className="font-bold text-lg text-emerald-500">+${money(tx.amount)}</div>
                      {tx.adjustment ? (
                         <div className="text-xs text-primary font-bold">Adj: +${money(tx.adjustment)}</div>
                      ) : null}
                    </div>
                  </div>
                );
              } else {
                const tx = item.data;
                return (
                  <div key={item.id} className="driver-ticket p-4 flex justify-between items-center" data-testid={`tx-bonus-${tx.id}`}>
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
                        <Star className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-sm uppercase truncate">Bonus: {tx.type.replace(/_/g, ' ')}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">{tx.reason}</div>
                        {(tx.performancePeriodStart || tx.performancePeriodEnd) && (
                          <div className="text-[10px] text-muted-foreground font-mono uppercase mt-0.5 truncate">
                            Period: {shortDate(tx.performancePeriodStart)} - {shortDate(tx.performancePeriodEnd)}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span className="truncate">{dateTime(tx.createdAt)}</span> • <span className={`uppercase font-bold ${tx.status === 'paid' ? 'text-emerald-500' : tx.status === 'reversed' ? 'text-destructive' : 'text-primary'}`}>{tx.status}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 pl-2">
                      <div className={`font-bold text-lg ${tx.status === 'reversed' ? 'text-destructive line-through' : tx.status === 'paid' ? 'text-emerald-500' : 'text-foreground'}`}>
                        ${money(tx.amountCents / 100)}
                      </div>
                    </div>
                  </div>
                );
              }
            })
          )}
        </div>
      </div>
    </div>
  );
}
