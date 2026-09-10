import { useState, useEffect, type ElementType } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAuthSession, getGetAuthSessionQueryKey,
  useGetAdminDashboard, getGetAdminDashboardQueryKey,
  useListAdminDriverReview, getListAdminDriverReviewQueryKey,
  useGetAdminDriverReview, getGetAdminDriverReviewQueryKey,
  useDecideAdminDriver,
  useReviewAdminDriverDocument,
  useListAdminPayments, getListAdminPaymentsQueryKey,
  useRequestAdminPaymentRefund,
  useListAdminSupportTickets, getListAdminSupportTicketsQueryKey,
  useListAdminSupportAgents, getListAdminSupportAgentsQueryKey,
  useListAdminSupportTicketComments, getListAdminSupportTicketCommentsQueryKey,
  useUpdateAdminSupportTicket,
  useCreateAdminSupportTicketComment,
  useListAdminPromotions, getListAdminPromotionsQueryKey,
  useGetAdminAnalytics, getGetAdminAnalyticsQueryKey, exportAdminAnalytics,
  useListAdminAuditLogs, getListAdminAuditLogsQueryKey,
} from '@workspace/api-client-react';
import { AppShell, LoadingState, ErrorState } from '@/components/app-shell';
import { ShieldAlert, Activity, Users, CreditCard, LifeBuoy, BarChart, Tag, History, Navigation, CheckCircle2, XCircle, AlertTriangle, FileText, Download } from 'lucide-react';
import { Link } from 'wouter';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

// --- Utils ---
function getStr(obj: unknown, key: string, fallback = ''): string {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === 'string') return val;
  }
  return fallback;
}
function getNum(obj: unknown, key: string, fallback = 0): number {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === 'number') return val;
  }
  return fallback;
}
function getArr(obj: unknown, key: string): unknown[] {
  if (obj && typeof obj === 'object' && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    if (Array.isArray(val)) return val;
  }
  return [];
}
function getObj(obj: unknown, key: string): Record<string, unknown> {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return {};
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultAnalyticsDates(): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  return { startDate: dateInputValue(start), endDate: dateInputValue(end) };
}

function isValidAnalyticsPeriod(startDate: string, endDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) return false;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())
    && start.toISOString().slice(0, 10) === startDate
    && end.toISOString().slice(0, 10) === endDate
    && end.getTime() - start.getTime() <= 365 * 24 * 60 * 60 * 1_000;
}

// --- Defs ---
type TabId = 'overview' | 'drivers' | 'payments' | 'support' | 'analytics' | 'promotions' | 'activity';

interface TabDef {
  id: TabId;
  label: string;
  icon: ElementType;
}

const ALL_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'drivers', label: 'Driver Review', icon: Users },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'analytics', label: 'Analytics', icon: BarChart },
  { id: 'promotions', label: 'Promotions', icon: Tag },
  { id: 'activity', label: 'Audit Log', icon: History },
];

function getTabsForRole(role: string): TabDef[] {
  if (role === 'admin') return ALL_TABS;
  if (role === 'dispatcher') return ALL_TABS.filter(t => ['overview', 'drivers', 'analytics'].includes(t.id));
  if (role === 'support') return ALL_TABS.filter(t => ['overview', 'support'].includes(t.id));
  return [];
}

// --- Page ---
export function OperationsPage() {
  const sessionQuery = useGetAuthSession({ query: { queryKey: getGetAuthSessionQueryKey() } });
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  if (sessionQuery.isLoading) return <AppShell><div className="pt-12"><LoadingState /></div></AppShell>;
  
  const role = sessionQuery.data?.profile?.role || 'customer';
  const isPermitted = ['admin', 'dispatcher', 'support'].includes(role);
  
  if (!isPermitted) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto pt-10 animate-enter">
          <div className="rounded-2xl border border-dashed border-[hsl(var(--destructive))]/50 bg-[hsl(var(--destructive))]/5 p-10 text-center">
            <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))]">
              <ShieldAlert className="size-5" />
            </div>
            <h2 className="font-display text-xl font-bold text-[hsl(var(--destructive))]">Operations Access Denied</h2>
            <p className="mx-auto mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
              You do not have administrative, dispatcher, or support permissions required to view this workspace.
            </p>
            <Link href="/" className="inline-flex mt-6 px-5 py-2.5 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full text-sm font-bold transition-transform hover:-translate-y-0.5">Return Home</Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const tabs = getTabsForRole(role);
  const currentTabDef = tabs.find(t => t.id === activeTab) || tabs[0];
  const CurrentTabId = currentTabDef ? currentTabDef.id : 'overview';

  return (
    <AppShell>
      <div className="animate-enter max-w-[1240px] mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end justify-between border-b border-[hsl(var(--border))] pb-4">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-[-.055em] text-[hsl(var(--primary))] uppercase flex items-center gap-3">
              <Activity className="size-6 text-[hsl(var(--accent))]" />
              Operations
            </h1>
            <p className="mt-1 text-xs font-mono uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">
              Raleigh Local Cargo • Internal Tools
            </p>
          </div>
          {(role === 'admin' || role === 'dispatcher') && (
            <Link href="/dispatch" className="inline-flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[hsl(var(--primary))] shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
              <Navigation className="size-4 text-[hsl(var(--chart-2))]" /> Dispatch Desk
            </Link>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
           <div className="lg:w-48 shrink-0">
              <nav className="flex flex-row lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 scrollbar-hide">
                {tabs.map(t => {
                   const Icon = t.icon;
                   const isActive = CurrentTabId === t.id;
                   return (
                     <button
                       key={t.id}
                       onClick={() => setActiveTab(t.id)}
                       className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${isActive ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-md' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--primary))]'}`}
                     >
                       <Icon className="size-4" /> {t.label}
                     </button>
                   )
                })}
              </nav>
           </div>
           
           <div className="flex-1 min-w-0">
               {CurrentTabId === 'overview' && <OverviewTab canViewRevenue={role === 'admin'} />}
               {CurrentTabId === 'drivers' && <DriversTab canDecide={role === 'admin'} />}
              {CurrentTabId === 'payments' && <PaymentsTab />}
              {CurrentTabId === 'support' && <SupportTab />}
               {CurrentTabId === 'analytics' && <AnalyticsTab canViewRevenue={role === 'admin'} />}
              {CurrentTabId === 'promotions' && <PromotionsTab />}
              {CurrentTabId === 'activity' && <ActivityTab />}
           </div>
        </div>
      </div>
    </AppShell>
  );
}

// --- Tabs ---

function OverviewTab({ canViewRevenue }: { canViewRevenue: boolean }) {
  const { data, isLoading, isError } = useGetAdminDashboard({ query: { queryKey: getGetAdminDashboardQueryKey() } });
  
  if (isLoading) return <LoadingState />;
  if (isError || !data) return <ErrorState />;
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
         <StatCard label="Active Routes" value={data.activeDeliveries} color="accent" />
         <StatCard label="Driver Search" value={data.searchingForDriver} color="destructive" />
         <StatCard label="Completed Today" value={data.completedToday} color="chart-2" />
         <StatCard label="Drivers Online" value={data.driversOnline} color="primary" />
      </div>
      
      <div className={`grid grid-cols-1 ${canViewRevenue ? 'lg:grid-cols-2' : ''} gap-4`}>
         {canViewRevenue && <StatCard label="Total Revenue" value={`$${(data.revenue ?? 0).toFixed(2)}`} color="chart-3" />}
         <StatCard label="Avg Delivery Time" value={data.averageDeliveryMinutes ? `${data.averageDeliveryMinutes}m` : '--'} color="muted-foreground" />
      </div>
      
      {data.trend && data.trend.length > 0 && (
        <div className="p-6 border border-[hsl(var(--border))] bg-[hsl(var(--card))] rounded-2xl shadow-soft">
           <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--primary))] mb-6 border-b border-[hsl(var(--border))] pb-2">7-Day Delivery Volume</h3>
           <div className="h-[250px]">
             <ResponsiveContainer width="100%" height="100%">
               <AreaChart data={data.trend}>
                 <defs>
                   <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                     <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.4}/>
                     <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0}/>
                   </linearGradient>
                 </defs>
                 <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                 <XAxis dataKey="date" tick={{fontSize: 10, fill: 'hsl(var(--muted-foreground))'}} axisLine={false} tickLine={false} />
                 <YAxis tick={{fontSize: 10, fill: 'hsl(var(--muted-foreground))'}} axisLine={false} tickLine={false} />
                 <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))', fontSize: '12px', fontWeight: 'bold' }} />
                 <Area type="monotone" dataKey="deliveries" name="Deliveries" stroke="hsl(var(--accent))" strokeWidth={3} fillOpacity={1} fill="url(#colorTrend)" />
               </AreaChart>
             </ResponsiveContainer>
           </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string, value: number | string, color: string }) {
  return (
    <div className="p-5 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
       <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: `hsl(var(--${color}))` }} />
       <div className="text-[10px] uppercase tracking-[.15em] font-bold text-[hsl(var(--muted-foreground))]">{label}</div>
       <div className="text-3xl font-display font-bold mt-3" style={{ color: `hsl(var(--${color}))` }}>{value}</div>
    </div>
  )
}

function DriversTab({ canDecide }: { canDecide: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: drivers = [], isLoading, isError } = useListAdminDriverReview({}, { query: { queryKey: getListAdminDriverReviewQueryKey() } });
  
  if (isLoading) return <LoadingState />;
  if (isError) return <ErrorState />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
       <div className="md:col-span-5 lg:col-span-4 space-y-2 max-h-[700px] overflow-y-auto pr-2 scrollbar-hide">
         {drivers.length === 0 && <div className="p-10 border border-dashed border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))]/50 text-center text-sm text-[hsl(var(--muted-foreground))]">No drivers require review.</div>}
         {drivers.map(d => {
            const id = getStr(d, 'id');
            const name = getStr(d, 'name') || getStr(d, 'firstName') + ' ' + getStr(d, 'lastName');
            const status = getStr(d, 'approvalStatus') || getStr(d, 'status');
            const isSelected = selectedId === id;
            return (
              <button 
                key={id} 
                onClick={() => setSelectedId(id)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${isSelected ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5 shadow-sm' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]/30'}`}
              >
                <div className={`font-bold text-sm ${isSelected ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--primary))]'}`}>{name}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(var(--muted-foreground))] mt-2 flex items-center gap-1.5">
                   <span className={`size-1.5 rounded-full ${status === 'pending' ? 'bg-[hsl(var(--accent))]' : status === 'approved' ? 'bg-[hsl(var(--chart-2))]' : 'bg-[hsl(var(--destructive))]'}`} />
                   {status.replace('_', ' ')}
                </div>
              </button>
            )
         })}
       </div>
       <div className="md:col-span-7 lg:col-span-8">
          {selectedId ? <DriverDetails id={selectedId} canDecide={canDecide} /> : <div className="h-full min-h-[400px] flex flex-col items-center justify-center border border-dashed border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))]/30 text-center text-[hsl(var(--muted-foreground))]"><FileText className="size-8 opacity-50 mb-3" /><p className="text-sm">Select a driver file to review.</p></div>}
       </div>
    </div>
  )
}

function DriverDetails({ id, canDecide }: { id: string; canDecide: boolean }) {
  const { data: driver, isLoading, isError } = useGetAdminDriverReview(id, { query: { queryKey: getGetAdminDriverReviewQueryKey(id) } });
  const decideDriver = useDecideAdminDriver();
  const reviewDoc = useReviewAdminDriverDocument();
  const queryClient = useQueryClient();
  
  if (isLoading) return <LoadingState />;
  if (isError || !driver) return <ErrorState />;
  
  const profile = getObj(driver, 'driver');
  const documents = getArr(driver, 'documents');
  const name = getStr(profile, 'name') || `${getStr(profile, 'firstName')} ${getStr(profile, 'lastName')}`.trim() || 'Unnamed driver';
  const status = getStr(profile, 'approvalStatus') || getStr(profile, 'status');
  const vehicle = `${getStr(profile, 'vehicleMake')} ${getStr(profile, 'vehicleModel')}`.trim();

  const handleDecision = (decision: 'approved' | 'rejected' | 'suspended') => {
    decideDriver.mutate({ id, data: { decision, reason: 'Admin review' } }, {
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: getListAdminDriverReviewQueryKey() });
         queryClient.invalidateQueries({ queryKey: getGetAdminDriverReviewQueryKey(id) });
      }
    });
  };

  const handleDoc = (docId: string, decision: 'approved' | 'rejected') => {
    reviewDoc.mutate({ id: docId, data: { decision, reason: 'Admin review' } }, {
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: getGetAdminDriverReviewQueryKey(id) });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-4 p-5 bg-[hsl(var(--card))] rounded-2xl border border-[hsl(var(--border))] shadow-soft">
         <div>
            <h3 className="font-display font-bold text-2xl text-[hsl(var(--primary))]">{name}</h3>
            <p className="text-[10px] font-mono uppercase tracking-widest text-[hsl(var(--muted-foreground))] mt-2">Status: {status}</p>
            {vehicle.trim() && <p className="text-sm mt-3 text-[hsl(var(--primary))] flex items-center gap-2"><CheckCircle2 className="size-4 text-[hsl(var(--chart-2))]" /> {vehicle}</p>}
         </div>
          {canDecide && <div className="flex flex-wrap gap-2">
            <button onClick={() => handleDecision('approved')} disabled={decideDriver.isPending} className="px-4 py-2 bg-[hsl(var(--chart-2))] text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-transform hover:-translate-y-0.5">Approve Profile</button>
            <button onClick={() => handleDecision('rejected')} disabled={decideDriver.isPending} className="px-4 py-2 bg-[hsl(var(--destructive))] text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-transform hover:-translate-y-0.5">Reject</button>
            <button onClick={() => handleDecision('suspended')} disabled={decideDriver.isPending} className="px-4 py-2 bg-[hsl(var(--muted))]/50 text-[hsl(var(--foreground))] text-[10px] font-bold uppercase tracking-wider rounded-xl transition-transform hover:-translate-y-0.5">Suspend</button>
          </div>}
      </div>
      
      <div className="space-y-4">
        <h4 className="text-[10px] font-bold text-[hsl(var(--primary))] uppercase tracking-[.15em] border-b border-[hsl(var(--border))] pb-2">Provided Documents</h4>
        {documents.length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))] italic p-4 bg-[hsl(var(--card))]/30 rounded-xl border border-dashed border-[hsl(var(--border))]">No documents on file.</p>}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {documents.map((doc: any) => {
             const docId = getStr(doc, 'id');
             const type = getStr(doc, 'documentType') || getStr(doc, 'type');
             const docStatus = getStr(doc, 'verificationStatus') || getStr(doc, 'status');
             
             return (
               <div key={docId} className="flex flex-col justify-between p-4 border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))]/50">
                  <div className="flex justify-between items-start mb-6">
                     <div>
                        <div className="font-bold text-sm text-[hsl(var(--primary))] capitalize">{type.replace(/_/g, ' ')}</div>
                        <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(var(--muted-foreground))] mt-1.5">Status: {docStatus}</div>
                     </div>
                     {docStatus === 'approved' && <CheckCircle2 className="size-5 text-[hsl(var(--chart-2))]" />}
                     {docStatus === 'rejected' && <XCircle className="size-5 text-[hsl(var(--destructive))]" />}
                  </div>
                  
                   {canDecide && docStatus === 'pending' && (
                    <div className="flex gap-2 mt-auto">
                      <button onClick={() => handleDoc(docId, 'approved')} disabled={reviewDoc.isPending} className="flex-1 text-[11px] uppercase tracking-wider font-bold px-3 py-2.5 bg-[hsl(var(--chart-2))]/10 text-[hsl(var(--chart-2))] hover:bg-[hsl(var(--chart-2))]/20 rounded-lg transition-colors">Approve Doc</button>
                      <button onClick={() => handleDoc(docId, 'rejected')} disabled={reviewDoc.isPending} className="flex-1 text-[11px] uppercase tracking-wider font-bold px-3 py-2.5 bg-[hsl(var(--destructive))]/10 text-[hsl(var(--destructive))] hover:bg-[hsl(var(--destructive))]/20 rounded-lg transition-colors">Reject Doc</button>
                    </div>
                  )}
               </div>
             )
          })}
        </div>
      </div>
    </div>
  )
}

function PaymentsTab() {
  const { data: payments = [], isLoading } = useListAdminPayments({}, { query: { queryKey: getListAdminPaymentsQueryKey() } });
  const [refunding, setRefunding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const refund = useRequestAdminPaymentRefund();
  const queryClient = useQueryClient();

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4">
       {payments.length === 0 && <div className="p-10 border border-dashed border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))]/50 text-center text-sm text-[hsl(var(--muted-foreground))]">No payments on record.</div>}
       <div className="grid grid-cols-1 gap-3">
         {payments.map(p => {
            const id = getStr(p, 'id');
            const amount = getNum(p, 'amount', 0);
            const status = getStr(p, 'status');
            const order = getStr(p, 'orderNumber', 'Unknown Order');
            
            return (
              <div key={id} className="p-5 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm transition-all hover:shadow-md">
                 <div>
                   <div className="flex items-center gap-3">
                     <span className="font-display font-bold text-xl text-[hsl(var(--primary))]">${(amount / 100).toFixed(2)}</span>
                     <span className="font-mono text-[10px] font-bold text-[hsl(var(--accent))] px-2 py-1 bg-[hsl(var(--accent))]/10 rounded-md border border-[hsl(var(--accent))]/20">{order}</span>
                   </div>
                   <div className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] mt-2 uppercase tracking-[.15em]">Status: {status}</div>
                 </div>
                 
                 {status === 'succeeded' || status === 'paid' ? (
                   refunding === id ? (
                     <div className="flex items-center gap-2 bg-[hsl(var(--background))] p-2 rounded-xl border border-[hsl(var(--destructive))]/20">
                       <input 
                         value={reason} 
                         onChange={e => setReason(e.target.value)} 
                         placeholder="Reason for refund..." 
                         className="text-xs px-3 py-2 w-48 rounded-lg border border-[hsl(var(--border))] bg-transparent outline-none focus:border-[hsl(var(--destructive))]" 
                       />
                       <button onClick={() => {
                          if (!reason.trim()) return;
                          refund.mutate({ id, data: { reason } }, {
                            onSuccess: () => {
                               setRefunding(null);
                               setReason('');
                               queryClient.invalidateQueries({ queryKey: getListAdminPaymentsQueryKey() });
                            }
                          });
                       }} disabled={refund.isPending} className="px-4 py-2 bg-[hsl(var(--destructive))] text-white text-[10px] uppercase tracking-wider font-bold rounded-lg transition-transform hover:-translate-y-0.5">Process</button>
                       <button onClick={() => setRefunding(null)} className="px-3 py-2 bg-transparent text-[10px] uppercase tracking-wider font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]">Cancel</button>
                     </div>
                   ) : (
                     <button onClick={() => setRefunding(id)} className="px-4 py-2 bg-[hsl(var(--secondary))] border border-[hsl(var(--border))] text-[hsl(var(--primary))] text-[10px] uppercase tracking-wider font-bold rounded-xl transition-transform hover:-translate-y-0.5 hover:bg-[hsl(var(--background))]">Issue Refund</button>
                   )
                 ) : (
                    <div className="px-4 py-2 bg-[hsl(var(--muted))]/30 text-[hsl(var(--muted-foreground))] text-[10px] uppercase tracking-wider font-bold rounded-xl border border-[hsl(var(--border))]/50">
                      Cannot Refund
                    </div>
                 )}
              </div>
            )
         })}
       </div>
    </div>
  )
}

function SupportTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: tickets = [], isLoading } = useListAdminSupportTickets({}, { query: { queryKey: getListAdminSupportTicketsQueryKey() } });
  
  if (isLoading) return <LoadingState />;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
       <div className="md:col-span-5 lg:col-span-4 space-y-3 max-h-[700px] overflow-y-auto pr-2 scrollbar-hide">
         {tickets.length === 0 && <div className="p-5 text-center text-sm text-[hsl(var(--muted-foreground))] italic border border-dashed border-[hsl(var(--border))] rounded-xl">No tickets found.</div>}
         {tickets.map(t => {
            const id = getStr(t, 'id');
            const category = getStr(t, 'category', 'General');
            const status = getStr(t, 'status');
            const isSelected = selectedId === id;
            return (
              <button 
                key={id} 
                onClick={() => setSelectedId(id)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${isSelected ? 'border-[hsl(var(--accent))] bg-[hsl(var(--accent))]/5 shadow-sm' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary))]/30'}`}
              >
                <div className={`font-bold text-sm ${isSelected ? 'text-[hsl(var(--accent))]' : 'text-[hsl(var(--primary))]'}`}>{category}</div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[hsl(var(--muted-foreground))] mt-2">{status}</div>
              </button>
            )
         })}
       </div>
       <div className="md:col-span-7 lg:col-span-8">
         {selectedId ? <SupportTicketDetails ticket={tickets.find(t => getStr(t, 'id') === selectedId)} /> : <div className="h-full min-h-[400px] flex flex-col items-center justify-center border border-dashed border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))]/30 text-center text-[hsl(var(--muted-foreground))]"><LifeBuoy className="size-8 opacity-50 mb-3" /><p className="text-sm">Select a ticket to review.</p></div>}
       </div>
    </div>
  )
}

function SupportTicketDetails({ ticket }: { ticket: unknown }) {
  const id = getStr(ticket, 'id');
  const rawSource = getStr(ticket, 'source');
  const source = rawSource === 'customer_ticket' || rawSource === 'driver_issue' ? rawSource : null;
  const querySource = source ?? 'customer_ticket';
  const message = getStr(ticket, 'message');
  const status = getStr(ticket, 'status');
  const priority = getStr(ticket, 'priority');
  const assigned = getStr(ticket, 'assignedProfileId');
  const [newComment, setNewComment] = useState('');
  const [assignVal, setAssignVal] = useState(assigned);
  useEffect(() => { setAssignVal(assigned); }, [assigned]);
  const queryClient = useQueryClient();
  const agentsQuery = useListAdminSupportAgents({ query: { queryKey: getListAdminSupportAgentsQueryKey() } });
  const commentsQuery = useListAdminSupportTicketComments(id || 'missing', querySource, {
    query: {
      enabled: Boolean(id && source),
      queryKey: getListAdminSupportTicketCommentsQueryKey(id || 'missing', querySource),
    },
  });
  const updateTicket = useUpdateAdminSupportTicket();
  const addComment = useCreateAdminSupportTicketComment();
  const agents = agentsQuery.data ?? [];
  const comments = commentsQuery.data ?? [];

  if (!id || !source) return <ErrorState title="Ticket details are unavailable" />;

  const handleUpdate = (updates: Record<string, string>) => {
    updateTicket.mutate({ id, data: updates }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketsQueryKey() })
    });
  }

  const handleComment = () => {
    if (!newComment.trim()) return;
    addComment.mutate({ id, source, data: { source, body: newComment } }, {
      onSuccess: () => {
        setNewComment('');
        queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminSupportTicketCommentsQueryKey(id, source) });
      }
    });
  }

  return (
    <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl p-6 space-y-6 shadow-soft">
      <div>
        <h3 className="text-[10px] font-bold text-[hsl(var(--primary))] uppercase tracking-[.15em] mb-3 border-b border-[hsl(var(--border))] pb-2">Customer Message</h3>
        <p className="text-sm leading-relaxed text-[hsl(var(--foreground))] whitespace-pre-wrap">{message}</p>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 border-t border-[hsl(var(--border))] pt-4">
        <div>
           <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] block mb-1.5">Status</label>
           <select 
             value={status} 
             onChange={e => handleUpdate({ status: e.target.value })}
             className="w-full text-xs font-bold p-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:border-[hsl(var(--accent))] outline-none"
             disabled={updateTicket.isPending}
           >
             <option value="open">Open</option>
             <option value="in_progress">In Progress</option>
             <option value="escalated">Escalated</option>
             <option value="resolved">Resolved</option>
           </select>
        </div>
        <div>
           <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] block mb-1.5">Priority</label>
           <select 
             value={priority} 
             onChange={e => handleUpdate({ priority: e.target.value })}
             className="w-full text-xs font-bold p-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:border-[hsl(var(--accent))] outline-none"
             disabled={updateTicket.isPending}
           >
             <option value="low">Low</option>
             <option value="normal">Normal</option>
             <option value="high">High</option>
             <option value="urgent">Urgent</option>
           </select>
        </div>
         <div>
            <label className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))] block mb-1.5">Assigned to</label>
            <select
              value={assignVal}
              onChange={(event) => {
                const assignedProfileId = event.target.value;
                setAssignVal(assignedProfileId);
                if (assignedProfileId && assignedProfileId !== assigned) handleUpdate({ assignedProfileId });
              }}
              className="w-full text-xs font-medium p-2.5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:border-[hsl(var(--accent))] outline-none"
              disabled={agentsQuery.isLoading || updateTicket.isPending}
            >
              <option value="">{agentsQuery.isLoading ? 'Loading staff…' : 'Choose an agent'}</option>
              {assigned && !agents.some((agent) => getStr(agent, 'id') === assigned) && <option value={assigned}>Current assignment</option>}
              {agents.map((agent) => {
                const agentId = getStr(agent, 'id');
                return <option key={agentId} value={agentId}>{getStr(agent, 'name') || `${getStr(agent, 'firstName')} ${getStr(agent, 'lastName')}`.trim()}</option>;
              })}
            </select>
        </div>
      </div>
      
      <div className="border-t border-[hsl(var(--border))] pt-6">
         <h3 className="text-[10px] font-bold text-[hsl(var(--primary))] uppercase tracking-[.15em] mb-4">Conversation</h3>
          <div className="space-y-3 mb-4 max-h-[300px] overflow-y-auto pr-2">
            {commentsQuery.isLoading && <div className="h-16 animate-pulse rounded-xl bg-[hsl(var(--muted))]" />}
            {commentsQuery.isError && <p className="text-xs text-[hsl(var(--destructive))]">Comments could not be loaded.</p>}
           {comments.length === 0 && <p className="text-xs text-[hsl(var(--muted-foreground))] italic bg-[hsl(var(--background))] p-4 rounded-xl border border-dashed border-[hsl(var(--border))]">No conversation replies yet. Reply below.</p>}
            {comments.map((c) => (
              <div key={getStr(c, 'id')} className="bg-[hsl(var(--background))] p-3 rounded-xl border border-[hsl(var(--border))] text-sm shadow-sm relative">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-[hsl(var(--chart-3))]/30 rounded-l-xl" />
                  <div className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] mb-1.5 ml-2">{getStr(c, 'authorName', 'Staff')} · {new Date(getStr(c, 'createdAt')).toLocaleString()}</div>
                 <div className="ml-2 text-[hsl(var(--foreground))]">{getStr(c, 'body')}</div>
              </div>
           ))}
         </div>
         <div className="flex gap-2">
            <input 
              value={newComment} 
              onChange={e => setNewComment(e.target.value)} 
              onKeyDown={e => e.key === 'Enter' && handleComment()}
              placeholder="Reply to the requester..."
              className="flex-1 text-sm p-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] focus:border-[hsl(var(--accent))] outline-none"
            />
            <button onClick={handleComment} disabled={addComment.isPending} className="px-5 py-3 bg-[hsl(var(--accent))] text-white font-bold text-[10px] uppercase tracking-[.1em] rounded-xl transition-transform hover:-translate-y-0.5 whitespace-nowrap">
              Send Reply
            </button>
         </div>
      </div>
    </div>
  )
}

function AnalyticsTab({ canViewRevenue }: { canViewRevenue: boolean }) {
  const defaults = defaultAnalyticsDates();
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [exportState, setExportState] = useState<'idle' | 'downloading' | 'empty' | 'error'>('idle');
  const isValidPeriod = isValidAnalyticsPeriod(startDate, endDate);
  const analyticsParams = isValidPeriod ? { startDate, endDate } : undefined;
  const analyticsQuery = useGetAdminAnalytics(
    analyticsParams,
    { query: { enabled: isValidPeriod, queryKey: getGetAdminAnalyticsQueryKey(analyticsParams) } },
  );
  const { data, isLoading, isError, refetch } = analyticsQuery;

  const daily = getArr(data, 'daily');
  const areas = getArr(data, 'topServiceAreas');
  const totalDeliveries = daily.reduce<number>((sum, row) => sum + getNum(row, 'deliveries'), 0);
  const totalRevenue = daily.reduce<number>((sum, row) => sum + getNum(row, 'revenue'), 0);
  const latestDay = daily.at(-1);
  const handleExport = async () => {
    setExportState('downloading');
    try {
      const csv = await exportAdminAnalytics({ startDate, endDate });
      if (!csv || csv.trim().split(/\r?\n/).length <= 2) {
        setExportState('empty');
        return;
      }
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `analytics-${startDate}-to-${endDate}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportState('idle');
    } catch {
      setExportState('error');
    }
  };

  return (
    <div className="space-y-6">
       {canViewRevenue && <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl p-5 shadow-soft">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--primary))]">Reporting period</h3>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Filter the analytics view and download a finance-ready CSV.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                From
                <input type="date" value={startDate} max={endDate} onChange={event => setStartDate(event.target.value)} className="mt-1 block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--accent))]" />
              </label>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                To
                <input type="date" value={endDate} min={startDate} onChange={event => setEndDate(event.target.value)} className="mt-1 block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-xs font-medium text-[hsl(var(--foreground))] outline-none focus:border-[hsl(var(--accent))]" />
              </label>
              <button onClick={handleExport} disabled={exportState === 'downloading' || !isValidPeriod} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[hsl(var(--primary-foreground))] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-download-analytics">
                <Download className="size-4" /> {exportState === 'downloading' ? 'Preparing…' : 'Download CSV'}
              </button>
            </div>
          </div>
          {exportState === 'empty' && <p className="mt-4 rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))] p-3 text-xs text-[hsl(var(--muted-foreground))]">No report data is available for this period. Choose a wider date range and try again.</p>}
          {exportState === 'error' && <p className="mt-4 rounded-xl border border-[hsl(var(--destructive))]/30 bg-[hsl(var(--destructive))]/5 p-3 text-xs text-[hsl(var(--destructive))]">This report could not be prepared. Check the dates and try again.</p>}
       </div>}
       {!isValidPeriod ? (
         <div className="rounded-2xl border border-dashed border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/5 p-8 text-center text-sm text-[hsl(var(--destructive))]">
           Choose a valid date range of up to 366 days to view or download this report.
         </div>
       ) : isLoading ? <LoadingState label="Loading report data" /> : isError || !data ? <ErrorState onRetry={() => refetch()} title="Analytics are unavailable" /> : (
         <>
       <div className={`grid grid-cols-1 ${canViewRevenue ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4`}>
         <StatCard label="Period deliveries" value={totalDeliveries} color="accent" />
         <StatCard label="Latest cancellation rate" value={`${Math.round(getNum(latestDay, 'cancellationRate') * 100)}%`} color="destructive" />
         {canViewRevenue && <StatCard label="Period revenue" value={`$${totalRevenue.toFixed(2)}`} color="chart-3" />}
       </div>
       {daily.length ? (
          <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl p-6 shadow-soft">
             <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--primary))] mb-6 border-b border-[hsl(var(--border))] pb-2">Delivery throughput</h3>
            <div className="h-[300px]">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily}>
                   <defs>
                      <linearGradient id="operations-delivery-gradient" x1="0" y1="0" x2="0" y2="1">
                       <stop offset="5%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3}/>
                       <stop offset="95%" stopColor="hsl(var(--chart-3))" stopOpacity={0}/>
                     </linearGradient>
                   </defs>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                   <XAxis dataKey="date" tick={{fontSize: 10, fill: 'hsl(var(--muted-foreground))'}} axisLine={false} tickLine={false} />
                   <YAxis tick={{fontSize: 10, fill: 'hsl(var(--muted-foreground))'}} axisLine={false} tickLine={false} />
                   <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))', fontSize: '12px' }} />
                    <Area type="monotone" dataKey="deliveries" name="Deliveries" stroke="hsl(var(--chart-3))" strokeWidth={2} fillOpacity={1} fill="url(#operations-delivery-gradient)" />
                 </AreaChart>
               </ResponsiveContainer>
            </div>
         </div>
       ) : (
          <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card))]/50 p-10 text-center text-sm text-[hsl(var(--muted-foreground))]">
             There is no delivery activity in this reporting period.
         </div>
       )}
       <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl p-6 shadow-soft">
          <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--primary))] mb-4 border-b border-[hsl(var(--border))] pb-2">Top service areas</h3>
          {areas.length ? <div className="space-y-3">{areas.map((area) => (
            <div key={getStr(area, 'area')} className="flex items-center justify-between gap-4 text-sm">
              <span className="min-w-0 truncate font-medium text-[hsl(var(--primary))]">{getStr(area, 'area', 'Unknown')}</span>
              <span className="shrink-0 rounded-md bg-[hsl(var(--secondary))] px-2 py-1 font-mono text-xs text-[hsl(var(--muted-foreground))]">{getNum(area, 'deliveries')} deliveries</span>
            </div>
          ))}</div> : <p className="text-sm text-[hsl(var(--muted-foreground))]">No service areas to report yet.</p>}
       </div>
        </>
       )}
    </div>
  )
}

function PromotionsTab() {
  const { data: promos = [], isLoading } = useListAdminPromotions({ query: { queryKey: getListAdminPromotionsQueryKey() } });
  
  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-4">
       {promos.length === 0 && <div className="p-10 border border-dashed border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))]/50 text-center text-sm text-[hsl(var(--muted-foreground))]">No active promotions.</div>}
       <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
         {promos.map(p => {
            const id = getStr(p, 'id');
            const code = getStr(p, 'code');
             const type = getStr(p, 'discountType');
             const value = getNum(p, 'discountValue');
             const active = getStr(p, 'active') !== 'false';
            
            return (
              <div key={id} className="p-6 border border-[hsl(var(--border))] rounded-2xl bg-[hsl(var(--card))] shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
                 <div className="absolute -right-6 -top-6 size-24 bg-[hsl(var(--chart-2))]/10 rounded-full blur-2xl pointer-events-none" />
                 <div className="font-mono font-bold text-2xl text-[hsl(var(--primary))] relative z-10 tracking-widest">{code}</div>
                  <div className="flex items-center gap-2 mt-4 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] relative z-10">
                    <Tag className="size-4 text-[hsl(var(--chart-2))]" /> {type.replace('_', ' ')} • {type === 'percentage' ? `${value}%` : `$${(value/100).toFixed(2)}`}
                 </div>
                  <p className={`mt-3 text-[10px] font-bold uppercase tracking-wider ${active ? 'text-[hsl(var(--chart-2))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{active ? 'Active' : 'Inactive'}</p>
              </div>
            )
         })}
       </div>
    </div>
  )
}

function ActivityTab() {
  const { data: logs = [], isLoading } = useListAdminAuditLogs({ query: { queryKey: getListAdminAuditLogsQueryKey() } });
  
  if (isLoading) return <LoadingState />;
  
  return (
    <div className="bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-2xl overflow-hidden shadow-soft">
      <div className="p-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/50">
         <h3 className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--primary))]">System Audit Trail</h3>
      </div>
      <div className="divide-y divide-[hsl(var(--border))]">
         {logs.length === 0 && <div className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No audit logs found.</div>}
         {logs.map(log => (
           <div key={log.id} className="p-4 hover:bg-[hsl(var(--secondary))]/30 transition-colors">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                 <div className="flex items-center gap-3">
                    <div className="grid place-items-center size-8 rounded-full bg-[hsl(var(--accent))]/10 text-[hsl(var(--accent))] shrink-0">
                       <History className="size-4" />
                    </div>
                    <div>
                       <span className="font-bold text-sm text-[hsl(var(--primary))] capitalize">{log.action.replace(/_/g, ' ')}</span>
                       <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5">
                          <strong className="font-bold text-[hsl(var(--foreground))]">{log.actorName || 'System'}</strong> modified {log.entityLabel || log.entityType}
                       </div>
                    </div>
                 </div>
                 <span className="text-[10px] font-mono text-[hsl(var(--muted-foreground))] bg-[hsl(var(--background))] px-2 py-1 rounded-md border border-[hsl(var(--border))] whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                 </span>
              </div>
           </div>
         ))}
      </div>
    </div>
  )
}
