import { Link } from 'wouter';
import { Bell, ChevronRight, CircleHelp, ShieldAlert } from 'lucide-react';

export default function Support() {
  return <div className="p-6">
    <div className="mb-7"><h1 className="flex items-center gap-3 font-display text-3xl font-bold uppercase"><CircleHelp className="size-8 text-primary" />Help & Support</h1><p className="mt-2 leading-6 text-muted-foreground">Get operational help and continue conversations with dispatch.</p></div>
    <div className="space-y-4">
      <Link href="/safety" className="driver-card flex min-h-24 items-center gap-4 p-5"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive"><ShieldAlert className="size-6" /></span><span className="min-w-0 flex-1"><b className="block">Safety and issue reports</b><span className="mt-1 block text-sm text-muted-foreground">Report delivery, payment, customer, vehicle, or safety issues and message dispatch.</span></span><ChevronRight className="size-5 shrink-0" /></Link>
      <Link href="/notifications" className="driver-card flex min-h-24 items-center gap-4 p-5"><span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary"><Bell className="size-6" /></span><span className="min-w-0 flex-1"><b className="block">Notifications</b><span className="mt-1 block text-sm text-muted-foreground">Review route updates and open replies from support.</span></span><ChevronRight className="size-5 shrink-0" /></Link>
    </div>
    <section className="driver-card mt-6 p-5"><h2 className="font-display text-lg font-bold uppercase">While on a delivery</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Use Active Delivery for route guidance, live-location sharing, recipient verification, and delivery completion. The Driver menu remains available throughout the route.</p><Link href="/active-delivery" className="driver-btn driver-btn-secondary mt-5 h-12 w-full">Open active delivery</Link></section>
  </div>;
}