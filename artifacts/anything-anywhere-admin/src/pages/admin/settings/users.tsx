import { useListAdminSettingsUsers, useUpdateAdminSettingsUser, useRevokeAdminSettingsUserSessions } from '@workspace/api-client-react';
import { Loader2, Shield, User, AlertCircle, RefreshCcw, LogOut, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import type { AdminSettingsUserUpdateRole, AdminSettingsUserUpdateStatus } from '@workspace/api-client-react';

export function AdminUsersSettings() {
  const { data: users, isLoading, isError, refetch } = useListAdminSettingsUsers();
  const update = useUpdateAdminSettingsUser();
  const revoke = useRevokeAdminSettingsUserSessions();

  const [revokingId, setRevokingId] = useState<string | null>(null);

  const handleUpdate = async (id: string, updates: { role?: AdminSettingsUserUpdateRole, status?: AdminSettingsUserUpdateStatus }) => {
    try {
      await update.mutateAsync({ id, data: updates });
      refetch();
    } catch (e) {
      alert('Failed to update user. Please try again.');
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to revoke all active sessions for this user? They will be signed out immediately.')) return;
    setRevokingId(id);
    try {
      const res = await revoke.mutateAsync({ id });
      alert(`Successfully revoked ${res.revokedSessionCount} session(s).`);
      refetch();
    } catch (e) {
      alert('Failed to revoke sessions.');
    } finally {
      setRevokingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-10 text-[hsl(var(--muted-foreground))]">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (isError || !users) {
    return (
      <div className="flex flex-col items-center justify-center p-10 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
        <p className="font-semibold">Failed to load admin users.</p>
        <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg"><RefreshCcw className="w-4 h-4 inline mr-2" />Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Admin Users & Roles</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          Manage staff access, roles, and active sessions.
        </p>
      </div>

      <div className="rounded-xl border bg-[hsl(var(--card))] shadow-sm overflow-hidden">
        <div className="border-b px-6 py-4 flex items-center justify-between bg-[hsl(var(--muted))]/30">
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="w-4 h-4 text-[hsl(var(--primary))]" /> Staff Accounts
          </h3>
        </div>

        <div className="divide-y">
          {users.map((user) => (
            <div key={user.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="flex items-start gap-4 flex-1">
                <div className="w-10 h-10 rounded-full bg-[hsl(var(--primary))]/10 flex items-center justify-center text-[hsl(var(--primary))] shrink-0">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-bold">{user.name}</p>
                    {user.status === 'active' ? (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wider dark:bg-emerald-900/30 dark:text-emerald-400">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-[10px] font-bold uppercase tracking-wider dark:bg-red-900/30 dark:text-red-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{user.email}</p>

                  <div className="mt-2 flex items-center gap-4 text-xs text-[hsl(var(--muted-foreground))]">
                    <span>Active Sessions: <strong className="text-[hsl(var(--foreground))]">{user.activeSessionCount}</strong></span>
                    {user.lastLogin && <span>Last Login: {new Date(user.lastLogin).toLocaleDateString()}</span>}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 md:justify-end">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Role</label>
                  <select
                    value={user.role}
                    onChange={(e) => handleUpdate(user.id, { role: e.target.value as AdminSettingsUserUpdateRole })}
                    disabled={update.isPending}
                    className="block w-full text-sm border rounded-md px-3 py-1.5 bg-[hsl(var(--background))] disabled:opacity-50"
                  >
                    <option value="admin">Admin</option>
                    <option value="dispatcher">Dispatcher</option>
                    <option value="support">Support</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Status</label>
                  <select
                    value={user.status}
                    onChange={(e) => handleUpdate(user.id, { status: e.target.value as AdminSettingsUserUpdateStatus })}
                    disabled={update.isPending}
                    className="block w-full text-sm border rounded-md px-3 py-1.5 bg-[hsl(var(--background))] disabled:opacity-50"
                  >
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>

                <div className="space-y-1 self-end">
                  <button
                    onClick={() => handleRevoke(user.id)}
                    disabled={revoke.isPending || revokingId === user.id || user.activeSessionCount === 0}
                    title="Sign out from all devices"
                    className="flex h-[34px] items-center gap-1.5 rounded-md border bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/30"
                  >
                    {revokingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                    Revoke Sessions
                  </button>
                </div>
              </div>
            </div>
          ))}

          {users.length === 0 && (
            <div className="p-10 text-center text-[hsl(var(--muted-foreground))]">
              No admin users found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
