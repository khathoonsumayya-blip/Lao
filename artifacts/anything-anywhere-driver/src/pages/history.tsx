import { useListDriverDeliveries } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { formatPickupSchedule } from '@/lib/pickup-schedule';
const terminal = ['delivered', 'cancelled', 'failed', 'refunded'];
export default function History() {
  const { data, isLoading, isError, refetch } = useListDriverDeliveries();
  if (isLoading) return <div className="p-6" role="status">Loading delivery history…</div>;
  if (isError) return <div className="p-6" role="alert">Delivery history is unavailable. <button className="underline" onClick={() => refetch()}>Try again</button></div>;
  const deliveries = (data || []).filter(d => terminal.includes(d.status));
  return <div className="p-6"><h1 className="font-display text-3xl font-bold uppercase mb-2">History</h1><p className="text-muted-foreground mb-6">Completed and closed deliveries available in your driver account.</p>{deliveries.length ? <div className="space-y-3">{deliveries.map(d => { const scheduled = d as typeof d & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }; return <Link key={d.id} href={`/delivery/${d.id}`} className="driver-card block p-4"><b>{d.orderNumber}</b><p className="mt-1 text-sm">{d.pickupAddress} → {d.dropoffAddress}</p><p className="mt-2 text-xs font-bold text-primary" data-testid={`text-history-pickup-schedule-${d.id}`}>Pickup window: {formatPickupSchedule(scheduled.scheduledPickupStartAt, scheduled.scheduledPickupEndAt)}</p><p className="mt-2 text-xs capitalize text-muted-foreground">{d.status.replaceAll('_', ' ')}</p></Link>})}</div> : <div className="driver-card p-6 text-center text-muted-foreground">No closed deliveries are available yet.</div>}</div>;
}