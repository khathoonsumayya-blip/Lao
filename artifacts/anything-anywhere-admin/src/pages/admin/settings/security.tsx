import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useGetAdminSecuritySettings, useUpdateAdminSecuritySettings, useRevokeOtherAdminSessions } from '@workspace/api-client-react';
import { Loader2, AlertCircle, ShieldCheck, Key, LogOut, CheckCircle2 } from 'lucide-react';
import { Link } from 'wouter';

const formSchema = z.object({
  sessionTimeoutMinutes: z.number().min(15).max(1440),
  suspiciousLoginAlerts: z.boolean(),
});

type FormValues = z.infer<typeof formSchema>;

export function SecuritySettings() {
  const { data, isLoading, isError, refetch } = useGetAdminSecuritySettings();
  const update = useUpdateAdminSecuritySettings();
  const revokeOther = useRevokeOtherAdminSessions();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      sessionTimeoutMinutes: 60,
      suspiciousLoginAlerts: true,
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        sessionTimeoutMinutes: data.sessionTimeoutMinutes,
        suspiciousLoginAlerts: data.suspiciousLoginAlerts,
      });
    }
  }, [data, form]);

  const onSubmit = async (values: FormValues) => {
    try {
      await update.mutateAsync({ data: values });
      form.reset(values);
    } catch (error) {
      alert('Failed to update security settings.');
    }
  };

  const handleRevokeOther = async () => {
    if (!confirm('This will sign you out of all other devices. Continue?')) return;
    try {
      const res = await revokeOther.mutateAsync();
      alert(`Successfully revoked ${res.revokedSessionCount} other session(s).`);
    } catch (e) {
      alert('Failed to revoke sessions.');
    }
  };

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[hsl(var(--muted-foreground))]" /></div>;
  if (isError) return (
    <div className="flex flex-col items-center p-10">
      <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
      <p className="font-semibold">Failed to load security settings.</p>
      <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg">Retry</button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Security Settings</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Manage authentication limits and session security.</p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="border-b px-6 py-4">
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[hsl(var(--primary))]" /> Platform Security
            </h3>
          </div>
          <div className="p-6 grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Session Timeout (Minutes)</label>
              <input type="number" {...form.register('sessionTimeoutMinutes', { valueAsNumber: true })} className="w-full px-3 py-2 border rounded-md" />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">Automatically log out inactive admins after this time.</p>
              {form.formState.errors.sessionTimeoutMinutes && <p className="text-xs text-red-500">{form.formState.errors.sessionTimeoutMinutes.message}</p>}
            </div>
            
            <div className="space-y-4 pt-8">
              <label className="flex items-center gap-3 text-sm font-medium cursor-pointer">
                <input type="checkbox" {...form.register('suspiciousLoginAlerts')} className="w-4 h-4 rounded border-[hsl(var(--primary))] text-[hsl(var(--primary))] focus:ring-[hsl(var(--primary))]" />
                Enable suspicious login alerts
              </label>
              <p className="text-xs text-[hsl(var(--muted-foreground))] ml-7">Send emails to admins when a login occurs from a new IP or country.</p>
            </div>
          </div>
          <div className="flex justify-end gap-4 p-6 border-t bg-[hsl(var(--muted))]/10">
            <button
              type="submit"
              disabled={update.isPending || !form.formState.isDirty}
              className="flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-6 py-2 font-bold text-[hsl(var(--primary-foreground))] transition hover:brightness-110 disabled:opacity-50"
            >
              {update.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : update.isSuccess ? <CheckCircle2 className="w-4 h-4" /> : null}
              Save Settings
            </button>
          </div>
        </div>
      </form>

      <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Key className="w-4 h-4 text-[hsl(var(--primary))]" /> My Account Security
          </h3>
        </div>
        <div className="p-6 grid gap-6 md:grid-cols-2">
          <div className="border rounded-lg p-4 flex flex-col justify-between">
            <div>
              <h4 className="font-bold mb-1">Change Password</h4>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">You will receive an email with a secure link to update your password.</p>
            </div>
            <Link href="/forgot-password" className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 border rounded-md font-medium text-sm hover:bg-[hsl(var(--muted))] transition">
              Request Password Reset
            </Link>
          </div>
          
          <div className="border rounded-lg p-4 flex flex-col justify-between">
            <div>
              <h4 className="font-bold mb-1">Active Sessions</h4>
              <p className="text-sm text-[hsl(var(--muted-foreground))] mb-4">Log out everywhere else except this current browser session.</p>
            </div>
            <button
              onClick={handleRevokeOther}
              disabled={revokeOther.isPending}
              className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 border border-red-200 bg-red-50 text-red-700 rounded-md font-medium text-sm hover:bg-red-100 transition disabled:opacity-50 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              {revokeOther.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogOut className="w-4 h-4 mr-2" />}
              Revoke Other Sessions
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
