import { useState, useMemo, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListAdminDriverPerformance,
  useGetAdminDriverPerformance,
  useListAdminDriverBonuses,
  useGetAdminDriverBonusSummary,
  useGetAdminDriverBonus,
  useCreateAdminDriverBonus,
  useUpdateAdminDriverBonusStatus,
  getListAdminDriverPerformanceQueryKey,
  getGetAdminDriverPerformanceQueryKey,
  getListAdminDriverBonusesQueryKey,
  getGetAdminDriverBonusSummaryQueryKey,
  getGetAdminDriverBonusQueryKey,
} from '@workspace/api-client-react';
import type { 
  DriverBonusInput, 
  DriverBonusStatusInput, 
  ListAdminDriverBonusesStatus,
  DriverPerformance,
  DriverBonusType
} from '@workspace/api-client-react';
import { AdminLayout } from './admin-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Loader2, DollarSign, Clock, Calendar, CheckCircle2, XCircle, ChevronRight, AlertCircle, Ban } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';

const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const formatDate = (dateString?: string | null) => dateString ? new Date(dateString).toLocaleDateString() : '-';
const formatDateTime = (dateString?: string | null) => dateString ? new Date(dateString).toLocaleString() : '-';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export function AdminRewards() {
  const queryClient = useQueryClient();
  const session = queryClient.getQueryData<{ profile?: { role?: string } }>(['admin-auth-session']);
  const isAdmin = session?.profile?.role === 'admin';

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Driver Rewards</h1>
        </div>
        <BonusSummary />
        
        <Tabs defaultValue="performance" className="space-y-4">
          <TabsList>
            <TabsTrigger value="performance">Performance & Bonuses</TabsTrigger>
            <TabsTrigger value="awards">All Awards</TabsTrigger>
          </TabsList>
          
          <TabsContent value="performance">
            <PerformanceTab isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="awards">
            <AwardsTab isAdmin={isAdmin} />
          </TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}

function BonusSummary() {
  const { data, isLoading, isError, refetch } = useGetAdminDriverBonusSummary({
    query: {
      queryKey: getGetAdminDriverBonusSummaryQueryKey(),
      // Totals can change when another administrator processes an award. Focus
      // refreshes them without continuously polling the API.
      refetchOnWindowFocus: true,
    },
  });

  if (isLoading) {
    return <div className="grid grid-cols-2 md:grid-cols-4 gap-4" aria-label="Loading bonus summary"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>;
  }
  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 py-5 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertCircle className="size-4" />Unable to load bonus summary.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending</CardTitle>
          <Clock className="size-4 text-[hsl(var(--muted-foreground))]" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCents(data.pendingCents)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Approved</CardTitle>
          <CheckCircle2 className="size-4 text-[hsl(var(--primary))]" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatCents(data.approvedCents)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Paid</CardTitle>
          <DollarSign className="size-4 text-emerald-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-emerald-600">{formatCents(data.paidCents)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Reversed</CardTitle>
          <Ban className="size-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-destructive">{formatCents(data.reversedCents)}</div>
        </CardContent>
      </Card>
    </div>
  );
}

function SkeletonCard() {
  return (
    <Card>
      <CardHeader className="pb-2"><div className="h-4 w-20 animate-pulse rounded bg-[hsl(var(--muted))]" /></CardHeader>
      <CardContent><div className="h-8 w-24 animate-pulse rounded bg-[hsl(var(--muted))]" /></CardContent>
    </Card>
  );
}

function PerformanceTab({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, from, to]);

  const { data: drivers, isLoading, isFetching } = useListAdminDriverPerformance({
    search: debouncedSearch || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-[hsl(var(--muted-foreground))]" />
          <Input 
            placeholder="Search drivers..." 
            className="pl-9" 
            value={search} 
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-[140px]" aria-label="Start date" />
          <span className="text-[hsl(var(--muted-foreground))]">to</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-[140px]" aria-label="End date" />
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto" role="region" aria-label="Driver performance table" tabIndex={0}>
          <p className="px-4 pt-3 text-xs text-[hsl(var(--muted-foreground))] sm:hidden">Swipe left or right to view all performance columns.</p>
          <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead>Driver</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">Acceptance</TableHead>
              <TableHead className="text-right">On-time</TableHead>
              <TableHead className="text-right">Rating</TableHead>
              <TableHead className="text-right">Pending Bonus</TableHead>
              <TableHead className="text-right">Paid Bonus</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-[hsl(var(--muted-foreground))]" />
                </TableCell>
              </TableRow>
            ) : drivers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-[hsl(var(--muted-foreground))]">
                  No driver performance records found.
                </TableCell>
              </TableRow>
            ) : (
              drivers?.map(driver => (
                <TableRow key={driver.driverId} className="cursor-pointer hover:bg-[hsl(var(--muted)/0.5)]" onClick={() => setSelectedDriverId(driver.driverId)}>
                  <TableCell className="font-medium">{driver.name}</TableCell>
                  <TableCell className="text-right">{driver.completedDeliveries}</TableCell>
                  <TableCell className="text-right">
                    {driver.acceptanceRate != null ? `${(driver.acceptanceRate * 100).toFixed(0)}%` : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {driver.onTimeRate != null ? `${(driver.onTimeRate * 100).toFixed(0)}%` : '-'}
                  </TableCell>
                  <TableCell className="text-right">{driver.rating != null ? driver.rating.toFixed(1) : '-'}</TableCell>
                  <TableCell className="text-right">{formatCents(driver.bonusTotals.pendingCents)}</TableCell>
                  <TableCell className="text-right">{formatCents(driver.bonusTotals.paidCents)}</TableCell>
                  <TableCell className="text-right text-[hsl(var(--muted-foreground))]"><ChevronRight className="inline size-4" /></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-3">
          <div className="text-sm text-[hsl(var(--muted-foreground))]">
            Page {page}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || isLoading || isFetching}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={!drivers || drivers.length < pageSize || isLoading || isFetching}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {selectedDriverId && (
        <DriverDetailSheet 
          driverId={selectedDriverId} 
          onClose={() => setSelectedDriverId(null)} 
          from={from || undefined} 
          to={to || undefined} 
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function DriverDetailSheet({ driverId, onClose, from, to, isAdmin }: { driverId: string; onClose: () => void; from?: string; to?: string; isAdmin: boolean }) {
  const { data, isLoading } = useGetAdminDriverPerformance({ driverId, from, to });
  const [isAwardOpen, setIsAwardOpen] = useState(false);

  return (
    <>
      <Sheet open={true} onOpenChange={(open) => !open && onClose()}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto sm:w-[540px]">
          <SheetHeader className="mb-6">
            <SheetTitle>Driver Details</SheetTitle>
          </SheetHeader>
          
          {isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-8 animate-spin text-[hsl(var(--muted-foreground))]" />
            </div>
          ) : !data ? (
            <div className="py-8 text-center text-[hsl(var(--muted-foreground))]">Driver not found</div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold">{data.performance.name}</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 rounded-lg border p-4 bg-[hsl(var(--muted)/0.3)]">
                  <div>
                    <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Completed Deliveries</div>
                    <div className="text-lg font-semibold">{data.performance.completedDeliveries}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Cancellations</div>
                    <div className="text-lg font-semibold">{data.performance.cancellations}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]" title={data.performance.acceptanceDefinition}>Acceptance Rate</div>
                    <div className="text-lg font-semibold">{data.performance.acceptanceRate != null ? `${(data.performance.acceptanceRate * 100).toFixed(0)}%` : '-'}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[hsl(var(--muted-foreground))]" title={data.performance.onTimeDefinition}>On-time Rate</div>
                    <div className="text-lg font-semibold">{data.performance.onTimeRate != null ? `${(data.performance.onTimeRate * 100).toFixed(0)}%` : '-'}</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Bonuses</h3>
                {isAdmin && (
                  <Button onClick={() => setIsAwardOpen(true)} size="sm">
                    Award Bonus
                  </Button>
                )}
              </div>
              
              {data.bonuses.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No bonuses recorded for this period.</p>
              ) : (
                <div className="space-y-3">
                  {data.bonuses.map(bonus => (
                    <BonusCard key={bonus.id} bonus={bonus} isAdmin={isAdmin} />
                  ))}
                </div>
              )}

              <h3 className="text-lg font-semibold pt-4">Delivery History</h3>
              {data.deliveries.length === 0 ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">No delivery history in this period.</p>
              ) : (
                <div className="space-y-2">
                  {data.deliveries.map(del => (
                    <div key={del.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="font-medium">Delivery {del.id.slice(0,8)}</span>
                        <Badge variant="outline">{del.status}</Badge>
                      </div>
                      <div className="flex justify-between text-[hsl(var(--muted-foreground))] text-xs">
                        <span>Assigned: {formatDateTime(del.assignedAt)}</span>
                        <span>Delivered: {formatDateTime(del.deliveredAt)}</span>
                      </div>
                      {del.estimatedDurationMinutes != null && (
                        <div className="text-xs text-[hsl(var(--muted-foreground))]">Est: {del.estimatedDurationMinutes}m</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {isAwardOpen && data && (
        <AwardBonusDialog 
          driverId={driverId} 
          driverName={data.performance.name}
          onClose={() => setIsAwardOpen(false)} 
        />
      )}
    </>
  );
}

function BonusCard({ bonus, isAdmin }: { bonus: any; isAdmin: boolean }) {
  const [isManageOpen, setIsManageOpen] = useState(false);
  const statusColors = {
    pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    approved: 'bg-blue-100 text-blue-800 border-blue-200',
    paid: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    reversed: 'bg-red-100 text-red-800 border-red-200',
  };

  return (
    <>
      <div className="rounded-lg border p-4 shadow-sm bg-[hsl(var(--card))]">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold">{formatCents(bonus.amountCents)}</span>
              <Badge variant="outline" className={statusColors[bonus.status as keyof typeof statusColors] || ''}>
                {bonus.status.toUpperCase()}
              </Badge>
            </div>
            <div className="mt-1 text-sm font-medium">{bonus.type.replace('_', ' ').toUpperCase()}</div>
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{bonus.reason}</div>
            {bonus.note && <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))] italic">Note: {bonus.note}</div>}
          </div>
          {isAdmin && <Button variant="outline" size="sm" onClick={() => setIsManageOpen(true)}>Manage</Button>}
        </div>
      </div>
      
      {isManageOpen && (
        <ManageBonusDialog bonusId={bonus.id} onClose={() => setIsManageOpen(false)} />
      )}
    </>
  );
}

function AwardBonusDialog({ driverId, driverName, onClose }: { driverId: string; driverName: string; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  
  const [amountStr, setAmountStr] = useState('');
  const [type, setType] = useState<string>('manual_performance');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  
  const amountCents = Math.round(parseFloat(amountStr || '0') * 100);
  const isValid = amountCents > 0 && reason.trim().length >= 3 && type;

  const createBonus = useCreateAdminDriverBonus({
    request: { headers: { 'Idempotency-Key': idempotencyKey } },
    mutation: {
      onSuccess: (createdBonus) => {
        toast({ title: 'Bonus Awarded', description: 'The bonus has been created successfully.' });
        queryClient.invalidateQueries({ queryKey: getListAdminDriverPerformanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverPerformanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminDriverBonusesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverBonusSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverBonusQueryKey(createdBonus.id) });
        onClose();
      },
      onError: (error: any) => {
        toast({ title: 'Failed to award bonus', description: error?.message || 'An unknown error occurred.', variant: 'destructive' });
      }
    }
  });

  const handleSubmit = () => {
    if (!isValid) return;
    createBonus.mutate({
      data: {
        driverId,
        amountCents,
        type: type as any,
        reason: reason.trim(),
        note: note.trim() || undefined,
        performancePeriodStart: start ? new Date(start).toISOString() : undefined,
        performancePeriodEnd: end ? new Date(end).toISOString() : undefined,
      }
    });
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Award Bonus to {driverName}</DialogTitle>
          <DialogDescription>Create a new bonus award. It will require approval before payment.</DialogDescription>
        </DialogHeader>

        {step === 'form' ? (
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Amount ($)</Label>
              <Input 
                type="number" 
                min="0.01" 
                step="0.01" 
                className="col-span-3" 
                value={amountStr} 
                onChange={e => {
                  setAmountStr(e.target.value);
                  setIdempotencyKey(crypto.randomUUID()); // Reset on edit
                }} 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Type</Label>
              <Select value={type} onValueChange={(v) => { setType(v); setIdempotencyKey(crypto.randomUUID()); }}>
                <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_performance">Manual Performance</SelectItem>
                  <SelectItem value="on_time">On-time Bonus</SelectItem>
                  <SelectItem value="weekend">Weekend Bonus</SelectItem>
                  <SelectItem value="streak">Streak Bonus</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Reason</Label>
              <Input 
                className="col-span-3" 
                placeholder="Clear reason required" 
                value={reason} 
                onChange={e => { setReason(e.target.value); setIdempotencyKey(crypto.randomUUID()); }} 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right">Note</Label>
              <Input 
                className="col-span-3" 
                placeholder="Optional internal note" 
                value={note} 
                onChange={e => { setNote(e.target.value); setIdempotencyKey(crypto.randomUUID()); }} 
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-xs">Period Start</Label>
              <Input type="date" className="col-span-3" value={start} onChange={e => { setStart(e.target.value); setIdempotencyKey(crypto.randomUUID()); }} />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label className="text-right text-xs">Period End</Label>
              <Input type="date" className="col-span-3" value={end} onChange={e => { setEnd(e.target.value); setIdempotencyKey(crypto.randomUUID()); }} />
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button disabled={!isValid} onClick={() => setStep('confirm')}>Continue to Confirm</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4 py-4">
            <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Driver</span> <span className="font-bold">{driverName}</span></div>
              <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Amount</span> <span className="font-bold text-lg">{formatCents(amountCents)}</span></div>
              <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Type</span> <span className="font-medium">{type.replace('_', ' ').toUpperCase()}</span></div>
              <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Reason</span> <span>{reason}</span></div>
              {(start || end) && <div className="flex justify-between"><span className="text-[hsl(var(--muted-foreground))]">Period</span> <span>{start} to {end}</span></div>}
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={() => setStep('form')} disabled={createBonus.isPending}>Back to Edit</Button>
              <Button onClick={handleSubmit} disabled={createBonus.isPending}>
                {createBonus.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Confirm Award
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ManageBonusDialog({ bonusId, onClose }: { bonusId: string; onClose: () => void }) {
  const { data, isLoading } = useGetAdminDriverBonus(bonusId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [step, setStep] = useState<'view' | 'confirm'>('view');
  const [action, setAction] = useState<'approve'|'pay'|'reverse'|null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const updateStatus = useUpdateAdminDriverBonusStatus({
    request: { headers: { 'Idempotency-Key': idempotencyKey } },
    mutation: {
      onSuccess: () => {
        toast({ title: 'Bonus Updated' });
        queryClient.invalidateQueries({ queryKey: getListAdminDriverPerformanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverPerformanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAdminDriverBonusesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverBonusSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverBonusQueryKey(bonusId) });
        onClose();
      },
      onError: (err: any) => {
        toast({ title: 'Update failed', description: err?.message, variant: 'destructive' });
      }
    }
  });

  const handleActionClick = (act: 'approve'|'pay'|'reverse') => {
    setAction(act);
    setReverseReason('');
    setIdempotencyKey(crypto.randomUUID());
    setStep('confirm');
  };

  const submitAction = () => {
    if (!action || !data) return;
    const targetStatus = action === 'pay' ? 'paid' : action === 'approve' ? 'approved' : 'reversed';
    if (action === 'reverse' && reverseReason.trim().length < 3) return;
    
    updateStatus.mutate({
      id: bonusId,
      data: {
        status: targetStatus,
        reason: action === 'reverse' ? reverseReason.trim() : undefined,
      }
    });
  };

  if (isLoading) return <Dialog open onOpenChange={onClose}><DialogContent><div className="flex h-32 items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div></DialogContent></Dialog>;
  if (!data) return null;

  const bonus = data.bonus;
  const isPendingUpdate = updateStatus.isPending;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !isPendingUpdate) onClose(); }}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Manage Bonus Award</DialogTitle>
          <DialogDescription>ID: {bonus.id}</DialogDescription>
        </DialogHeader>

        {step === 'view' && (
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-2 text-sm border p-4 rounded-lg bg-[hsl(var(--muted)/0.3)]">
              <div className="text-[hsl(var(--muted-foreground))]">Amount</div>
              <div className="font-bold">{formatCents(bonus.amountCents)}</div>
              
              <div className="text-[hsl(var(--muted-foreground))]">Status</div>
              <div className="font-medium uppercase">{bonus.status}</div>
              
              <div className="text-[hsl(var(--muted-foreground))]">Type</div>
              <div>{bonus.type}</div>
              
              <div className="text-[hsl(var(--muted-foreground))]">Reason</div>
              <div>{bonus.reason}</div>
            </div>

            {data.events && data.events.length > 0 && (
              <div className="pt-2">
                <h4 className="font-semibold text-sm mb-2">History</h4>
                <div className="space-y-2 text-xs">
                  {data.events.map(ev => (
                    <div key={ev.id} className="flex justify-between items-center text-[hsl(var(--muted-foreground))] border-b pb-1 last:border-0">
                      <span>{ev.type} {ev.toStatus && `-> ${ev.toStatus}`}</span>
                      <span>{formatDateTime(ev.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end pt-4">
              {bonus.status === 'pending' && (
                <>
                  <Button variant="destructive" onClick={() => handleActionClick('reverse')}>Reverse</Button>
                  <Button onClick={() => handleActionClick('approve')}>Approve</Button>
                </>
              )}
              {bonus.status === 'approved' && (
                <>
                  <Button variant="destructive" onClick={() => handleActionClick('reverse')}>Reverse</Button>
                  <Button onClick={() => handleActionClick('pay')}>Mark as Paid</Button>
                </>
              )}
              {bonus.status === 'paid' && (
                <Button variant="destructive" onClick={() => handleActionClick('reverse')}>Reverse Payment</Button>
              )}
            </div>
          </div>
        )}

        {step === 'confirm' && action && (
          <div className="space-y-4 py-4">
            <div className="rounded-lg p-4 bg-[hsl(var(--muted)/0.5)]">
              <h4 className="font-semibold text-lg mb-2 capitalize">{action} Bonus</h4>
              <p className="text-sm">You are about to transition this bonus to <strong>{action === 'pay' ? 'PAID' : action === 'approve' ? 'APPROVED' : 'REVERSED'}</strong>.</p>
              
              {action === 'reverse' && (
                <div className="mt-4">
                  <Label>Reason for Reversal</Label>
                  <Textarea 
                    className="mt-1" 
                    placeholder="Must provide a clear reason" 
                    value={reverseReason} 
                    onChange={e => {
                      setReverseReason(e.target.value);
                      setIdempotencyKey(crypto.randomUUID());
                    }} 
                  />
                </div>
              )}
            </div>
            
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('view')} disabled={isPendingUpdate}>Back</Button>
              <Button 
                variant={action === 'reverse' ? 'destructive' : 'default'} 
                onClick={submitAction} 
                disabled={isPendingUpdate || (action === 'reverse' && reverseReason.trim().length < 3)}
              >
                {isPendingUpdate && <Loader2 className="mr-2 size-4 animate-spin" />}
                Confirm {action}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AwardsTab({ isAdmin }: { isAdmin: boolean }) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);
  const [status, setStatus] = useState<ListAdminDriverBonusesStatus | ''>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedBonusId, setSelectedBonusId] = useState<string | null>(null);

  const { data: bonuses, isLoading } = useListAdminDriverBonuses({
    search: debouncedSearch || undefined,
    status: status || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-[hsl(var(--muted-foreground))]" />
          <Input 
            placeholder="Search by driver or reason..." 
            className="pl-9" 
            value={search} 
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(v: any) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="reversed">Reversed</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-2 items-center">
          <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="w-[140px]" aria-label="Start date" />
          <span className="text-[hsl(var(--muted-foreground))]">to</span>
          <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="w-[140px]" aria-label="End date" />
        </div>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Driver ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  <Loader2 className="mx-auto size-6 animate-spin text-[hsl(var(--muted-foreground))]" />
                </TableCell>
              </TableRow>
            ) : bonuses?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-[hsl(var(--muted-foreground))]">
                  No awards found matching filters.
                </TableCell>
              </TableRow>
            ) : (
              bonuses?.map(bonus => (
                <TableRow
                  key={bonus.id}
                  className={isAdmin ? 'cursor-pointer hover:bg-[hsl(var(--muted)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset' : undefined}
                  role={isAdmin ? 'button' : undefined}
                  tabIndex={isAdmin ? 0 : undefined}
                  aria-label={isAdmin ? `Manage bonus for ${bonus.driverId}` : undefined}
                  onClick={isAdmin ? () => setSelectedBonusId(bonus.id) : undefined}
                  onKeyDown={isAdmin ? (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedBonusId(bonus.id);
                    }
                  } : undefined}
                >
                  <TableCell className="whitespace-nowrap text-sm">{formatDate(bonus.createdAt)}</TableCell>
                  <TableCell className="font-mono text-xs">{bonus.driverId.slice(0, 8)}</TableCell>
                  <TableCell className="text-sm">{bonus.type}</TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate" title={bonus.reason}>{bonus.reason}</TableCell>
                  <TableCell className="text-right font-medium">{formatCents(bonus.amountCents)}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline" className={
                      bonus.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      bonus.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                      bonus.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                      'bg-red-100 text-red-800'
                    }>
                      {bonus.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedBonusId(bonus.id);
                        }}
                      >
                        Manage
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      {selectedBonusId && isAdmin && (
        <ManageBonusDialog bonusId={selectedBonusId} onClose={() => setSelectedBonusId(null)} />
      )}
    </div>
  );
}
