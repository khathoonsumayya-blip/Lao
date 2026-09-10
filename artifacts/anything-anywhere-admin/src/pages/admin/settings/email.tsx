import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useGetAdminEmailSettings, useUpdateAdminEmailSettings, useSendAdminSettingsTestEmail } from '@workspace/api-client-react';
import { Loader2, AlertCircle, Mail, CheckCircle2, Send, SwitchCamera } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

const formSchema = z.object({
  senderDisplayName: z.string().min(1).max(120),
  replyToEmail: z.string().email('Invalid email').max(320).optional().nullable().or(z.literal('')),
  supportEmail: z.string().email('Invalid email').max(320).optional().nullable().or(z.literal('')),
  welcomeEnabled: z.boolean(),
  passwordResetEnabled: z.boolean(),
  orderConfirmationEnabled: z.boolean(),
  orderDeliveredEnabled: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export function EmailSettings() {
  const { data, isLoading, isError, refetch } = useGetAdminEmailSettings();
  const update = useUpdateAdminEmailSettings();
  const sendTest = useSendAdminSettingsTestEmail();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      senderDisplayName: '',
      replyToEmail: '',
      supportEmail: '',
      welcomeEnabled: true,
      passwordResetEnabled: true,
      orderConfirmationEnabled: true,
      orderDeliveredEnabled: true,
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        senderDisplayName: data.senderDisplayName || '',
        replyToEmail: data.replyToEmail || '',
        supportEmail: data.supportEmail || '',
        welcomeEnabled: data.welcomeEnabled,
        passwordResetEnabled: data.passwordResetEnabled,
        orderConfirmationEnabled: data.orderConfirmationEnabled,
        orderDeliveredEnabled: data.orderDeliveredEnabled,
      });
    }
  }, [data, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      // Normalize empty strings to null for the API
      const payload = {
        ...values,
        replyToEmail: values.replyToEmail || null,
        supportEmail: values.supportEmail || null,
      };
      await update.mutateAsync({ data: payload });
      form.reset(values);
    } catch (error) {
      alert('Failed to update email settings.');
    }
  };

  const handleTestEmail = async () => {
    try {
      await sendTest.mutateAsync();
      alert('Test email queued for delivery. Check your admin email address.');
    } catch (e) {
      alert('Failed to send test email.');
    }
  };

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  if (isError) return (
    <div className="flex flex-col items-center p-10">
      <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
      <p className="font-semibold">Failed to load email settings.</p>
      <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Email & Communications</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Configure system emails and automated notifications.</p>
        </div>
        <button
          onClick={handleTestEmail}
          disabled={sendTest.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] font-semibold hover:bg-[hsl(var(--secondary))]/80 transition disabled:opacity-50"
        >
          {sendTest.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send Test Email
        </button>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Mail className="w-4 h-4 text-[hsl(var(--primary))]" /> Sender Information
            </h3>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2 max-w-md">
              <label className="text-sm font-medium">Sender Display Name</label>
              <input {...form.register('senderDisplayName')} placeholder="e.g. Anything Anywhere Support" className="w-full px-3 py-2 border rounded-md" />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">The name customers see in their inbox.</p>
              {form.formState.errors.senderDisplayName && <p className="text-xs text-red-500">{form.formState.errors.senderDisplayName.message}</p>}
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Reply-To Address (Optional)</label>
              <input type="email" {...form.register('replyToEmail')} placeholder="support@example.com" className="w-full px-3 py-2 border rounded-md" />
              {form.formState.errors.replyToEmail && <p className="text-xs text-red-500">{form.formState.errors.replyToEmail.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Support Contact Address (Optional)</label>
              <input type="email" {...form.register('supportEmail')} placeholder="support@example.com" className="w-full px-3 py-2 border rounded-md" />
              {form.formState.errors.supportEmail && <p className="text-xs text-red-500">{form.formState.errors.supportEmail.message}</p>}
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4 bg-[hsl(var(--muted))]/30">
            <h3 className="font-semibold flex items-center gap-2">
              <SwitchCamera className="w-4 h-4 text-[hsl(var(--primary))]" /> Automated Emails
            </h3>
          </div>
          <div className="divide-y">
            <div className="p-6 flex items-center justify-between gap-4">
              <div>
                <h4 className="font-medium">Welcome Email</h4>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Sent to users when they successfully verify their email address and register.</p>
              </div>
              <Switch
                checked={form.watch('welcomeEnabled')}
                onCheckedChange={(checked) => form.setValue('welcomeEnabled', checked, { shouldDirty: true })}
              />
            </div>
            
            <div className="p-6 flex items-center justify-between gap-4">
              <div>
                <h4 className="font-medium">Password Reset</h4>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Sent when a user requests a secure password reset link. (Recommended: On)</p>
              </div>
              <Switch
                checked={form.watch('passwordResetEnabled')}
                onCheckedChange={(checked) => form.setValue('passwordResetEnabled', checked, { shouldDirty: true })}
              />
            </div>

            <div className="p-6 flex items-center justify-between gap-4">
              <div>
                <h4 className="font-medium">Order Confirmation</h4>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Sent to customers immediately after successful payment for a new delivery.</p>
              </div>
              <Switch
                checked={form.watch('orderConfirmationEnabled')}
                onCheckedChange={(checked) => form.setValue('orderConfirmationEnabled', checked, { shouldDirty: true })}
              />
            </div>

            <div className="p-6 flex items-center justify-between gap-4">
              <div>
                <h4 className="font-medium">Delivery Completed</h4>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">Sent to customers when their package is successfully dropped off and verified.</p>
              </div>
              <Switch
                checked={form.watch('orderDeliveredEnabled')}
                onCheckedChange={(checked) => form.setValue('orderDeliveredEnabled', checked, { shouldDirty: true })}
              />
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
