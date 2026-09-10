import { useState } from 'react';
import { useLocation } from 'wouter';
import { ArrowRight, AtSign, LockKeyhole } from 'lucide-react';
import '@/admin.css';
import { apiUrl } from '@/lib/api-url';

const staffRoles = new Set(['admin', 'dispatcher', 'support']);

async function authRequest(path: string, body?: Record<string, string>) {
  const response = await fetch(apiUrl(`/api/auth/${path}`), {
    method: body ? 'POST' : 'GET',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'We could not complete that request.');
  return payload;
}

async function signOut() {
  await fetch(apiUrl('/api/auth/signout'), {
    method: 'POST',
    credentials: 'include',
  });
}

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const payload = await authRequest('sign-in', { email, password });
      if (!staffRoles.has(payload.profile?.role)) {
        await signOut();
        throw new Error('This account does not have Admin Desk access.');
      }
      onSuccess();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Login failed.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="aa-admin-theme flex min-h-screen items-center justify-center bg-[hsl(var(--background))] p-6">
      <div className="w-full max-w-md space-y-8 rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-8 shadow-xl">
        <div>
          <h2 className="aa-admin-font-sans text-center text-3xl font-extrabold tracking-tight text-[hsl(var(--foreground))]">
            Admin Desk
          </h2>
          <p className="mt-2 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Staff access only.
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={submit}>
          <div className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Staff Email
              </span>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'admin-login-error' : undefined}
                  placeholder={import.meta.env.DEV ? 'demo.admin@anything-anywhere.local' : 'staff@anythinganywhere.local'}
                  className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-10 py-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/20"
                />
              </div>
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                Password
              </span>
              <div className="relative">
                <LockKeyhole className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'admin-login-error' : undefined}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-10 py-3 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/20"
                />
              </div>
            </label>
          </div>

          {error && (
            <div id="admin-login-error" className="rounded-lg bg-[hsl(var(--destructive))]/10 p-4 text-sm text-[hsl(var(--destructive))]" role="alert">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending || !email || !password}
            className="group relative flex w-full justify-center rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-semibold text-[hsl(var(--primary-foreground))] transition-all hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50"
            data-testid="button-admin-login"
          >
            {pending ? 'Signing in...' : 'Enter Desk'}
            <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
          </button>
        </form>
        {import.meta.env.DEV && (
          <aside className="rounded-xl border border-dashed border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/5 p-4 text-sm text-[hsl(var(--muted-foreground))]" role="note">
            <p className="font-semibold text-[hsl(var(--foreground))]">Development demo access</p>
            <p className="mt-1 leading-6">
              Run <code className="rounded bg-[hsl(var(--background))] px-1 py-0.5 text-xs">ALLOW_DEMO_SEED=true pnpm --filter @workspace/db run seed</code> first, then use the seeded staff account:
            </p>
            <dl className="mt-3 space-y-1 text-xs">
              <div className="flex justify-between gap-4"><dt>Email</dt><dd className="font-mono text-[hsl(var(--foreground))]">demo.admin@anything-anywhere.local</dd></div>
              <div className="flex justify-between gap-4"><dt>Password</dt><dd className="font-mono text-[hsl(var(--foreground))]">DemoAdmin2026!</dd></div>
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}
