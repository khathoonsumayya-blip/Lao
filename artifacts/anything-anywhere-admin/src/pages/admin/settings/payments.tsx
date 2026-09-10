import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useGetAdminPaymentFeeSettings, useUpdateAdminPaymentFeeSettings } from '@workspace/api-client-react';
import { Loader2, AlertCircle, DollarSign, CheckCircle2, Percent, Calculator, Info } from 'lucide-react';

const formSchema = z.object({
  currency: z.literal('USD'),
  customerServiceFeeCents: z.number().min(0).max(100000),
  deliveryFeeCents: z.number().min(0).max(100000),
  smallOrderThresholdCents: z.number().min(0).max(1000000),
  smallOrderFeeCents: z.number().min(0).max(100000),
  taxRateBasisPoints: z.number().min(0).max(10000),
  refundWindowDays: z.number().min(0).max(365),
});

type FormValues = z.infer<typeof formSchema>;

export function PaymentsSettings() {
  const { data, isLoading, isError, refetch } = useGetAdminPaymentFeeSettings();
  const update = useUpdateAdminPaymentFeeSettings();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      currency: 'USD',
      customerServiceFeeCents: 0,
      deliveryFeeCents: 0,
      smallOrderThresholdCents: 0,
      smallOrderFeeCents: 0,
      taxRateBasisPoints: 0,
      refundWindowDays: 30,
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        currency: data.currency as any,
        customerServiceFeeCents: data.customerServiceFeeCents,
        deliveryFeeCents: data.deliveryFeeCents,
        smallOrderThresholdCents: data.smallOrderThresholdCents,
        smallOrderFeeCents: data.smallOrderFeeCents,
        taxRateBasisPoints: data.taxRateBasisPoints,
        refundWindowDays: data.refundWindowDays,
      });
    }
  }, [data, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      await update.mutateAsync({ data: values });
      form.reset(values);
    } catch (error) {
      alert('Failed to update payment settings.');
    }
  };

  // Convert dollars to cents for form handling
  const getDollarValue = (cents: number) => (cents / 100).toFixed(2);
  const getPercentage = (bps: number) => (bps / 100).toFixed(2);

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  if (isError) return (
    <div className="flex flex-col items-center p-10">
      <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
      <p className="font-semibold">Failed to load payment settings.</p>
      <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Payments & Fees</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Configure global pricing rules. Note: Updates apply only to new quotes; existing stored quotes remain unchanged.</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
            <h3 className="font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-[hsl(var(--primary))]" /> Currency & Refunds
            </h3>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Platform Currency</label>
              <select {...form.register('currency')} className="w-full px-3 py-2 border rounded-md uppercase">
                <option value="USD">USD - US Dollar</option>
              </select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Refund Window (Days)</label>
              <input type="number" {...form.register('refundWindowDays', { valueAsNumber: true })} className="w-full px-3 py-2 border rounded-md" />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Maximum days after delivery a refund can be issued.</p>
              {form.formState.errors.refundWindowDays && <p className="text-xs text-red-500">{form.formState.errors.refundWindowDays.message}</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[hsl(var(--primary))]" /> Fee Structure (in Cents)
            </h3>
          </div>
          <div className="p-6">
            <div className="mb-6 p-4 rounded-lg bg-[hsl(var(--primary))]/5 border border-[hsl(var(--primary))]/20 flex items-start gap-3 text-sm text-[hsl(var(--primary))]">
              <Info className="w-5 h-5 shrink-0 mt-0.5" />
              <p>Enter all monetary values in <strong>cents</strong> (e.g., $5.00 = 500). Changes made here will only affect delivery quotes generated after you save. In-progress deliveries retain the pricing they were quoted at.</p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Base Delivery Fee</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-[hsl(var(--muted-foreground))]">¢</span>
                  <input type="number" {...form.register('deliveryFeeCents', { valueAsNumber: true })} className="w-full pl-8 pr-3 py-2 border rounded-md" />
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Currently: ${getDollarValue(form.watch('deliveryFeeCents') || 0)}</p>
                {form.formState.errors.deliveryFeeCents && <p className="text-xs text-red-500">{form.formState.errors.deliveryFeeCents.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Customer Service Fee</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-[hsl(var(--muted-foreground))]">¢</span>
                  <input type="number" {...form.register('customerServiceFeeCents', { valueAsNumber: true })} className="w-full pl-8 pr-3 py-2 border rounded-md" />
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Currently: ${getDollarValue(form.watch('customerServiceFeeCents') || 0)}</p>
                {form.formState.errors.customerServiceFeeCents && <p className="text-xs text-red-500">{form.formState.errors.customerServiceFeeCents.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Small Order Threshold</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-[hsl(var(--muted-foreground))]">¢</span>
                  <input type="number" {...form.register('smallOrderThresholdCents', { valueAsNumber: true })} className="w-full pl-8 pr-3 py-2 border rounded-md" />
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Apply fee if order is under ${getDollarValue(form.watch('smallOrderThresholdCents') || 0)}</p>
                {form.formState.errors.smallOrderThresholdCents && <p className="text-xs text-red-500">{form.formState.errors.smallOrderThresholdCents.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Small Order Fee</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-[hsl(var(--muted-foreground))]">¢</span>
                  <input type="number" {...form.register('smallOrderFeeCents', { valueAsNumber: true })} className="w-full pl-8 pr-3 py-2 border rounded-md" />
                </div>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Currently: ${getDollarValue(form.watch('smallOrderFeeCents') || 0)}</p>
                {form.formState.errors.smallOrderFeeCents && <p className="text-xs text-red-500">{form.formState.errors.smallOrderFeeCents.message}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Percent className="w-4 h-4 text-[hsl(var(--primary))]" /> Taxes
            </h3>
          </div>
          <div className="p-6">
            <div className="space-y-2 max-w-md">
              <label className="text-sm font-medium">Tax Rate (Basis Points)</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-[hsl(var(--muted-foreground))]">bps</span>
                <input type="number" {...form.register('taxRateBasisPoints', { valueAsNumber: true })} className="w-full pl-12 pr-3 py-2 border rounded-md" />
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">1 basis point = 0.01%. Currently: {getPercentage(form.watch('taxRateBasisPoints') || 0)}%</p>
              {form.formState.errors.taxRateBasisPoints && <p className="text-xs text-red-500">{form.formState.errors.taxRateBasisPoints.message}</p>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-4 border-t pt-6">
          <button
            type="submit"
            disabled={update.isPending || !form.formState.isDirty}
            className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-6 py-2.5 font-bold text-[hsl(var(--primary-foreground))] shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : update.isSuccess ? <CheckCircle2 className="w-4 h-4" /> : null}
            Save Settings
          </button>
        </div>
      </form>
    </div>
  );
}
