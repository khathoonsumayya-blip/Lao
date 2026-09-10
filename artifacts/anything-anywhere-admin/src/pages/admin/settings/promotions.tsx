import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useListAdminPromotions, useCreateAdminPromotion, useUpdateAdminPromotion, useUpdateAdminPromotionStatus } from '@workspace/api-client-react';
import { Loader2, AlertCircle, Plus, Tag, RefreshCcw, CheckCircle2, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const promotionSchema = z.object({
  code: z.string().min(3).max(40).regex(/^[A-Z0-9_-]+$/, 'Uppercase letters, numbers, hyphens, underscores only'),
  description: z.string().max(300).nullable(),
  discountType: z.enum(['percent', 'fixed']),
  discountValue: z.number().positive().max(100000),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  maxRedemptions: z.number().min(1).max(1000000).nullable(),
});

type PromotionFormValues = z.infer<typeof promotionSchema>;

export function PromotionsSettings() {
  const { data: promotions, isLoading, isError, refetch } = useListAdminPromotions();
  const create = useCreateAdminPromotion();
  const update = useUpdateAdminPromotion();
  const updateStatus = useUpdateAdminPromotionStatus();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<PromotionFormValues>({
    resolver: zodResolver(promotionSchema),
    defaultValues: {
      code: '',
      description: null,
      discountType: 'percent',
      discountValue: 0,
      startsAt: null,
      expiresAt: null,
      maxRedemptions: null,
    }
  });

  const onSubmit = async (values: PromotionFormValues) => {
    try {
      const payload = {
        ...values,
        description: values.description || null,
        startsAt: values.startsAt || null,
        expiresAt: values.expiresAt || null,
        maxRedemptions: values.maxRedemptions || null,
      };

      if (editingId) {
        await update.mutateAsync({ id: editingId, data: payload });
      } else {
        await create.mutateAsync({ data: payload });
      }
      setIsDialogOpen(false);
      refetch();
    } catch (error) {
      alert('Failed to save promotion. Check code uniqueness.');
    }
  };

  const handleEdit = (promo: any) => {
    setEditingId(promo.id);
    form.reset({
      code: promo.code,
      description: promo.description || null,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
      startsAt: promo.startsAt ? promo.startsAt.split('T')[0] : null,
      expiresAt: promo.expiresAt ? promo.expiresAt.split('T')[0] : null,
      maxRedemptions: promo.maxRedemptions || null,
    });
    setIsDialogOpen(true);
  };

  const handleCreateNew = () => {
    setEditingId(null);
    form.reset({
      code: '',
      description: null,
      discountType: 'percent',
      discountValue: 0,
      startsAt: null,
      expiresAt: null,
      maxRedemptions: null,
    });
    setIsDialogOpen(true);
  };

  const toggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateStatus.mutateAsync({ id, data: { active: !currentStatus } });
      refetch();
    } catch (e) {
      alert('Failed to update promotion status.');
    }
  };

  if (isLoading) {
    return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  }

  if (isError || !promotions) {
    return (
      <div className="flex flex-col items-center p-10 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
        <p className="font-semibold">Failed to load promotions.</p>
        <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg"><RefreshCcw className="w-4 h-4 inline mr-2" />Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Promotions & Discounts</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Manage promo codes available for customers.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <button onClick={handleCreateNew} className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] hover:brightness-110">
              <Plus className="w-4 h-4" /> New Promotion
            </button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Promotion' : 'Create Promotion'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-medium">Promo Code</label>
                  <input {...form.register('code')} className="w-full px-3 py-2 border rounded-md" placeholder="e.g. SUMMER2024" />
                  {form.formState.errors.code && <p className="text-xs text-red-500">{form.formState.errors.code.message}</p>}
                </div>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-medium">Description</label>
                  <input {...form.register('description', { setValueAs: v => v === '' ? null : v })} className="w-full px-3 py-2 border rounded-md" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Discount Type</label>
                  <select {...form.register('discountType')} className="w-full px-3 py-2 border rounded-md">
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Flat Amount (Cents)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Value</label>
                  <input type="number" {...form.register('discountValue', { valueAsNumber: true })} className="w-full px-3 py-2 border rounded-md" />
                  {form.formState.errors.discountValue && <p className="text-xs text-red-500">{form.formState.errors.discountValue.message}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Start Date</label>
                  <input type="date" {...form.register('startsAt', { setValueAs: v => v === '' ? null : v })} className="w-full px-3 py-2 border rounded-md" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">End Date</label>
                  <input type="date" {...form.register('expiresAt', { setValueAs: v => v === '' ? null : v })} className="w-full px-3 py-2 border rounded-md" />
                </div>
                <div className="space-y-2 col-span-2">
                  <label className="text-sm font-medium">Max Redemptions (Optional)</label>
                  <input type="number" {...form.register('maxRedemptions', { setValueAs: v => v === '' || isNaN(v) ? null : parseInt(v, 10) })} className="w-full px-3 py-2 border rounded-md" />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button type="button" onClick={() => setIsDialogOpen(false)} className="px-4 py-2 border rounded-md font-medium">Cancel</button>
                <button type="submit" disabled={create.isPending || update.isPending} className="flex items-center gap-2 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-md font-bold disabled:opacity-50">
                  {(create.isPending || update.isPending) ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Save
                </button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
          <h3 className="font-semibold flex items-center gap-2">
            <Tag className="w-4 h-4 text-[hsl(var(--primary))]" /> Active & Past Promotions
          </h3>
        </div>
        
        {promotions.length === 0 ? (
          <div className="p-10 text-center text-[hsl(var(--muted-foreground))]">
            No promotions created yet.
          </div>
        ) : (
          <div className="divide-y">
            {promotions.map((promo: any) => (
              <div key={promo.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[hsl(var(--muted))]/10 transition">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-mono text-lg font-bold text-[hsl(var(--primary))]">{promo.code}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                      promo.active ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {promo.active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm mb-2">{promo.description || 'No description'}</p>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>Discount: <strong className="text-[hsl(var(--foreground))]">{promo.discountType === 'percent' ? `${promo.discountValue}%` : `$${(promo.discountValue / 100).toFixed(2)}`}</strong></span>
                    <span>Redemptions: <strong className="text-[hsl(var(--foreground))]">{promo.redemptionCount}</strong> {promo.maxRedemptions ? `/ ${promo.maxRedemptions}` : ''}</span>
                    {promo.expiresAt && <span>Expires: {new Date(promo.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                
                <div className="flex items-center gap-3 self-end md:self-auto shrink-0">
                  <button onClick={() => toggleStatus(promo.id, promo.active)} disabled={updateStatus.isPending} className="px-3 py-1.5 border rounded-md text-sm font-medium hover:bg-[hsl(var(--muted))] disabled:opacity-50">
                    {promo.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => handleEdit(promo)} className="flex items-center justify-center w-8 h-8 rounded-md bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/20">
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
