import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { Navigation, RefreshCw } from 'lucide-react';
import { useListDriverDeliveries } from '@workspace/api-client-react';

const terminal = ['delivered', 'cancelled', 'failed', 'refunded'];

export default function ActiveDelivery() {
  const [, setLocation] = useLocation();
  const deliveries = useListDriverDeliveries();
  const active = deliveries.data?.find((delivery) => !terminal.includes(delivery.status));

  useEffect(() => {
    if (active) setLocation(`/deliveries/${active.id}`, { replace: true });
  }, [active, setLocation]);

  if (deliveries.isLoading || active) return <div className="p-6 pt-16 text-center" role="status">Opening your active delivery…</div>;
  if (deliveries.isError) return <div className="p-6 pt-16 text-center" role="alert"><div className="driver-card p-6"><p className="font-bold">We could not check your active delivery.</p><button type="button" onClick={() => deliveries.refetch()} className="driver-btn driver-btn-primary mt-5 w-full"><RefreshCw className="size-4" />Try again</button></div></div>;

  return <div className="p-6 pt-12 text-center">
    <div className="driver-card p-7">
      <Navigation className="mx-auto size-12 text-primary" />
      <h1 className="mt-5 font-display text-2xl font-bold uppercase">No Active Delivery</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">When you accept a delivery, its route, live-location controls, recipient verification code, and completion steps will open here.</p>
      <Link href="/available-deliveries" className="driver-btn driver-btn-primary mt-6 h-12 w-full">View available deliveries</Link>
      <Link href="/history" className="driver-btn driver-btn-secondary mt-3 h-12 w-full">Open delivery history</Link>
    </div>
  </div>;
}