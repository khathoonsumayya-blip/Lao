import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { 
  useGetAdminDispatchSettings, 
  useUpdateAdminDispatchSettings, 
  getGetAdminDispatchSettingsQueryKey 
} from '@workspace/api-client-react';
import { Loader2, AlertCircle, CheckCircle2, Radar, ShieldAlert, Plus, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const stageSchema = z.object({
  radiusMiles: z.coerce.number().int('Must be an integer').min(1).max(100),
  durationSeconds: z.coerce.number().int('Must be an integer').min(1).max(3600),
});

const formSchema = z.object({
  initialRadiusMiles: z.coerce.number().int('Must be an integer').min(1, 'Must be at least 1').max(100),
  maximumRadiusMiles: z.coerce.number().int('Must be an integer').min(1, 'Must be at least 1').max(100),
  initialDurationSeconds: z.coerce.number().int('Must be an integer').min(1, 'Must be at least 1').max(3600),
  expansionStages: z.array(stageSchema).min(1, 'At least one expansion stage is required').max(8, 'Maximum 8 stages allowed'),
  maximumPickupEtaMinutes: z.coerce.number().int('Must be an integer').min(1, 'Must be at least 1').max(120),
  totalExpirationSeconds: z.coerce.number().int('Must be an integer').min(60, 'Must be at least 60').max(3600),
}).superRefine((data, ctx) => {
  if (data.initialRadiusMiles > data.maximumRadiusMiles) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Initial radius cannot exceed maximum radius.",
      path: ["initialRadiusMiles"]
    });
  }

  let lastRadius = data.initialRadiusMiles;
  for (let i = 0; i < data.expansionStages.length; i++) {
    const stage = data.expansionStages[i];
    if (stage.radiusMiles <= lastRadius) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each expansion stage radius must be strictly greater than the previous stage's radius.",
        path: ["expansionStages", i, "radiusMiles"]
      });
    }
    if (stage.radiusMiles > data.maximumRadiusMiles) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expansion stage radii cannot exceed the maximum radius.",
        path: ["expansionStages", i, "radiusMiles"]
      });
    }
    lastRadius = stage.radiusMiles;
  }

  let totalDuration = data.initialDurationSeconds;
  for (const stage of data.expansionStages) {
    totalDuration += stage.durationSeconds;
  }
  if (totalDuration > data.totalExpirationSeconds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cumulative stage durations plus initial duration cannot exceed the total offer expiration.",
      path: ["expansionStages"]
    });
  }
});

type FormValues = z.infer<typeof formSchema>;

export function DispatchSettings() {
  const { data, isLoading, isError, refetch } = useGetAdminDispatchSettings();
  const update = useUpdateAdminDispatchSettings();
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      initialRadiusMiles: 3,
      maximumRadiusMiles: 12,
      initialDurationSeconds: 30,
      expansionStages: [
        { radiusMiles: 5, durationSeconds: 30 },
        { radiusMiles: 8, durationSeconds: 60 },
        { radiusMiles: 12, durationSeconds: 480 },
      ],
      maximumPickupEtaMinutes: 15,
      totalExpirationSeconds: 600,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "expansionStages",
  });

  useEffect(() => {
    if (data) {
      form.reset({
        initialRadiusMiles: data.initialRadiusMiles,
        maximumRadiusMiles: data.maximumRadiusMiles,
        initialDurationSeconds: data.initialDurationSeconds,
        expansionStages: data.expansionStages.map(s => ({ ...s })),
        maximumPickupEtaMinutes: data.maximumPickupEtaMinutes,
        totalExpirationSeconds: data.totalExpirationSeconds,
      });
    }
  }, [data, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      setSubmitError(null);
      await update.mutateAsync({ data: values });
      queryClient.setQueryData(getGetAdminDispatchSettingsQueryKey(), { ...values, updatedAt: new Date().toISOString() });
      form.reset(values); // reset dirty state
    } catch (error) {
      setSubmitError('Failed to save dispatch settings. Please verify constraints and try again.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-[hsl(var(--muted-foreground))]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center p-10 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
        <p className="font-semibold">Failed to load dispatch settings.</p>
        <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dispatch Policy</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))] mt-1">
          Configure how the system discovers drivers. Offers are staged progressively: they are sent simultaneously to all available drivers within the current radius. If no driver accepts before the stage duration elapses, the search expands to the next stage's radius.
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        
        {/* Core Constraints */}
        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30 rounded-t-xl">
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[hsl(var(--primary))]" /> Global Constraints
            </h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Absolute limits applied to all delivery requests before routing.
            </p>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Maximum Radius</label>
              <div className="relative">
                <input type="number" {...form.register('maximumRadiusMiles')} className="w-full pl-3 pr-16 py-2 border rounded-md bg-[hsl(var(--background))]" />
                <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">miles</span>
              </div>
              {form.formState.errors.maximumRadiusMiles && <p className="text-xs text-red-500">{form.formState.errors.maximumRadiusMiles.message}</p>}
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Absolute hard limit on distance to pickup. Search stages cannot exceed this.</p>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Maximum Pickup ETA</label>
              <div className="relative">
                <input type="number" {...form.register('maximumPickupEtaMinutes')} className="w-full pl-3 pr-16 py-2 border rounded-md bg-[hsl(var(--background))]" />
                <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">minutes</span>
              </div>
              {form.formState.errors.maximumPickupEtaMinutes && <p className="text-xs text-red-500">{form.formState.errors.maximumPickupEtaMinutes.message}</p>}
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Drivers further away than this will never receive an offer, regardless of radius.</p>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Total Offer Expiration</label>
              <div className="relative">
                <input type="number" {...form.register('totalExpirationSeconds')} className="w-full pl-3 pr-16 py-2 border rounded-md bg-[hsl(var(--background))]" />
                <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">seconds</span>
              </div>
              {form.formState.errors.totalExpirationSeconds && <p className="text-xs text-red-500">{form.formState.errors.totalExpirationSeconds.message}</p>}
              <p className="text-[11px] text-[hsl(var(--muted-foreground))]">If no driver accepts within this duration, the delivery fails to find a driver.</p>
            </div>
          </div>
        </div>

        {/* Staging Configuration */}
        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Radar className="w-4 h-4 text-[hsl(var(--primary))]" /> Search Expansion Stages
            </h3>
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
              Configure the initial search radius and subsequent expansion rings. Each stage must have a strictly larger radius than the previous.
            </p>
            {form.formState.errors.expansionStages?.root && (
              <p className="text-sm font-medium text-red-500 mt-2 bg-red-500/10 p-2 rounded">
                {form.formState.errors.expansionStages.root.message}
              </p>
            )}
          </div>
          
          <div className="p-0">
            {/* Initial Stage */}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_40px] gap-4 p-4 border-b bg-[hsl(var(--primary))]/5">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">Initial Stage Radius</label>
                <div className="relative">
                  <input type="number" {...form.register('initialRadiusMiles')} className="w-full pl-3 pr-12 py-2 border rounded-md bg-white dark:bg-black font-medium" />
                  <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">mi</span>
                </div>
                {form.formState.errors.initialRadiusMiles && <p className="text-xs text-red-500">{form.formState.errors.initialRadiusMiles.message}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--primary))]">Wait Duration</label>
                <div className="relative">
                  <input type="number" {...form.register('initialDurationSeconds')} className="w-full pl-3 pr-12 py-2 border rounded-md bg-white dark:bg-black font-medium" />
                  <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">sec</span>
                </div>
                {form.formState.errors.initialDurationSeconds && <p className="text-xs text-red-500">{form.formState.errors.initialDurationSeconds.message}</p>}
              </div>
              <div className="flex items-end justify-center pb-2 hidden sm:flex">
                <div className="w-8 h-8 flex items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white text-sm font-bold">1</div>
              </div>
            </div>

            {/* Expansion Stages */}
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_40px] gap-4 p-4 border-b last:border-b-0 hover:bg-[hsl(var(--muted))]/10 transition-colors">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Expansion Stage {index + 1} Radius</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      {...form.register(`expansionStages.${index}.radiusMiles`)} 
                      className="w-full pl-3 pr-12 py-2 border rounded-md bg-[hsl(var(--background))]" 
                    />
                    <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">mi</span>
                  </div>
                  {form.formState.errors.expansionStages?.[index]?.radiusMiles && <p className="text-xs text-red-500">{form.formState.errors.expansionStages[index].radiusMiles.message}</p>}
                </div>
                
                <div className="space-y-1">
                  <label className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Wait Duration</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      {...form.register(`expansionStages.${index}.durationSeconds`)} 
                      className="w-full pl-3 pr-12 py-2 border rounded-md bg-[hsl(var(--background))]" 
                    />
                    <span className="absolute right-3 top-2 text-sm text-[hsl(var(--muted-foreground))]">sec</span>
                  </div>
                  {form.formState.errors.expansionStages?.[index]?.durationSeconds && <p className="text-xs text-red-500">{form.formState.errors.expansionStages[index].durationSeconds.message}</p>}
                </div>

                <div className="flex items-end justify-center pb-1">
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="p-2 w-full sm:w-auto flex justify-center text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    title="Remove stage"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-[hsl(var(--muted))]/10 border-t">
            <button
              type="button"
              onClick={() => append({ 
                radiusMiles: fields.length > 0 
                  ? Math.min(form.getValues(`expansionStages.${fields.length - 1}.radiusMiles`) + 2, form.getValues('maximumRadiusMiles')) 
                  : Math.min(form.getValues('initialRadiusMiles') + 2, form.getValues('maximumRadiusMiles')), 
                durationSeconds: 60 
              })}
              disabled={fields.length >= 8}
              className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--primary))] hover:brightness-110 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add Expansion Stage
            </button>
          </div>
        </div>

        {submitError && (
          <div className="text-sm font-medium text-red-500 bg-red-500/10 p-4 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" /> 
            <div>{submitError}</div>
          </div>
        )}

        <div className="flex justify-end gap-4 border-t pt-6">
          <button
            type="submit"
            disabled={update.isPending || !form.formState.isDirty}
            className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-6 py-2.5 font-bold text-[hsl(var(--primary-foreground))] shadow-sm transition hover:brightness-110 disabled:opacity-50"
          >
            {update.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
            ) : update.isSuccess ? (
              <><CheckCircle2 className="w-4 h-4" /> Saved</>
            ) : (
              'Save Dispatch Policy'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
