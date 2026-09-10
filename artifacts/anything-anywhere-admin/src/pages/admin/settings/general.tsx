import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useGetAdminSettings, useUpdateAdminGeneralSettings } from '@workspace/api-client-react';
import { Building2, Mail, Phone, MapPin, Globe, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

const formSchema = z.object({
  businessName: z.string().min(1, 'Business Name is required').max(160),
  appName: z.string().min(1, 'App Name is required').max(160),
  tagline: z.string().max(300).optional().default(''),
  businessEmail: z.string().email('Invalid email').max(320),
  supportEmail: z.string().email('Invalid email').max(320),
  supportPhone: z.string().max(40).optional().default(''),
  businessAddress: z.string().max(500).optional().default(''),
  website: z.string().url('Invalid URL (must include http/https)').max(2048),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code (e.g. USD)'),
  country: z.string().regex(/^[A-Z]{2}$/, 'Must be a 2-letter country code (e.g. US)'),
  timeZone: z.string().min(1).max(100),
  dateFormat: z.enum(['MM/dd/yyyy', 'dd/MM/yyyy', 'yyyy-MM-dd']),
  distanceUnit: z.enum(['mi', 'km']),
});

type FormValues = z.infer<typeof formSchema>;

export function GeneralSettings() {
  const { data, isLoading, isError, refetch } = useGetAdminSettings();
  const update = useUpdateAdminGeneralSettings();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: '',
      appName: '',
      tagline: '',
      businessEmail: '',
      supportEmail: '',
      supportPhone: '',
      businessAddress: '',
      website: '',
      defaultCurrency: 'USD',
      country: 'US',
      timeZone: 'America/New_York',
      dateFormat: 'MM/dd/yyyy',
      distanceUnit: 'mi',
    },
  });

  useEffect(() => {
    if (data?.general) {
      form.reset({
        businessName: data.general.businessName || '',
        appName: data.general.appName || '',
        tagline: data.general.tagline || '',
        businessEmail: data.general.businessEmail || '',
        supportEmail: data.general.supportEmail || '',
        supportPhone: data.general.supportPhone || '',
        businessAddress: data.general.businessAddress || '',
        website: data.general.website || '',
        defaultCurrency: data.general.defaultCurrency || 'USD',
        country: data.general.country || 'US',
        timeZone: data.general.timeZone || 'America/New_York',
        dateFormat: (data.general.dateFormat as any) || 'MM/dd/yyyy',
        distanceUnit: (data.general.distanceUnit as any) || 'mi',
      });
    }
  }, [data, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      await update.mutateAsync({ data: values });
      form.reset(values); // reset dirty state
    } catch (error) {
      alert('Failed to update settings. Please try again.');
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
        <p className="font-semibold">Failed to load settings.</p>
        <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">General Information</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Configure the public identity and default formats for the platform.
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[hsl(var(--primary))]" /> Brand Identity
            </h3>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Business Name</label>
              <input {...form.register('businessName')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.businessName && <p className="text-xs text-red-500">{form.formState.errors.businessName.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">App Name (Short)</label>
              <input {...form.register('appName')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.appName && <p className="text-xs text-red-500">{form.formState.errors.appName.message}</p>}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium">Tagline</label>
              <input {...form.register('tagline')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.tagline && <p className="text-xs text-red-500">{form.formState.errors.tagline.message}</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Mail className="w-4 h-4 text-[hsl(var(--primary))]" /> Contact Information
            </h3>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Business Email</label>
              <input type="email" {...form.register('businessEmail')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.businessEmail && <p className="text-xs text-red-500">{form.formState.errors.businessEmail.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Support Email</label>
              <input type="email" {...form.register('supportEmail')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.supportEmail && <p className="text-xs text-red-500">{form.formState.errors.supportEmail.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Phone className="w-3 h-3" /> Support Phone
              </label>
              <input type="tel" {...form.register('supportPhone')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.supportPhone && <p className="text-xs text-red-500">{form.formState.errors.supportPhone.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Globe className="w-3 h-3" /> Website
              </label>
              <input type="url" {...form.register('website')} placeholder="https://" className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.website && <p className="text-xs text-red-500">{form.formState.errors.website.message}</p>}
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <MapPin className="w-3 h-3" /> HQ Address
              </label>
              <textarea {...form.register('businessAddress')} rows={2} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.businessAddress && <p className="text-xs text-red-500">{form.formState.errors.businessAddress.message}</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Globe className="w-4 h-4 text-[hsl(var(--primary))]" /> Localization
            </h3>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Default Currency</label>
              <input {...form.register('defaultCurrency')} placeholder="USD" className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.defaultCurrency && <p className="text-xs text-red-500">{form.formState.errors.defaultCurrency.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Country Code</label>
              <input {...form.register('country')} placeholder="US" className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.country && <p className="text-xs text-red-500">{form.formState.errors.country.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Time Zone</label>
              <input {...form.register('timeZone')} placeholder="America/New_York" className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]" />
              {form.formState.errors.timeZone && <p className="text-xs text-red-500">{form.formState.errors.timeZone.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Date Format</label>
              <select {...form.register('dateFormat')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]">
                <option value="MM/dd/yyyy">MM/dd/yyyy</option>
                <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                <option value="yyyy-MM-dd">yyyy-MM-dd</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Distance Unit</label>
              <select {...form.register('distanceUnit')} className="w-full px-3 py-2 border rounded-md bg-[hsl(var(--background))]">
                <option value="mi">Miles (mi)</option>
                <option value="km">Kilometers (km)</option>
              </select>
            </div>
          </div>
        </div>

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
              'Save Changes'
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
