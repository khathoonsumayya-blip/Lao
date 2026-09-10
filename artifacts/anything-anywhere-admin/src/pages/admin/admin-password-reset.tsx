import { useState, type FormEvent } from 'react';
import { apiUrl } from '@/lib/api-url';
import '@/admin.css';

async function adminAuthRequest(path: string, body: Record<string, string>) {
  const response = await fetch(apiUrl(`/api/auth/admin/${path}`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'We could not complete that request.');
  return payload;
}

function AdminAuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="aa-admin-theme grid min-h-[100dvh] place-items-center p-6">
      <section className="w-full max-w-md rounded-3xl border bg-[hsl(var(--card))] p-8 shadow-xl">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-[hsl(var(--primary))]">Authorized staff only</p>
        <h1 className="mt-3 text-3xl font-extrabold">{title}</h1>
        {children}
      </section>
    </main>
  );
}

const inputClassName = 'relative z-10 mt-2 block min-h-12 w-full touch-manipulation appearance-none rounded-xl border bg-[hsl(var(--background))] px-3 py-3 pointer-events-auto outline-none focus:border-[hsl(var(--primary))] focus:ring-4 focus:ring-[hsl(var(--primary))]/10';
const adminLoginUrl = import.meta.env.BASE_URL;

export function AdminForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await adminAuthRequest('password-reset', { email });
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not send recovery instructions.');
    } finally {
      setPending(false);
    }
  };

  return (
    <AdminAuthFrame title="Reset your Admin password">
      <form onSubmit={submit} className="mt-6 space-y-5">
        <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">
          Enter your staff email. If it is registered, we’ll send a secure Admin reset link that expires in 30 minutes.
        </p>
        <div>
          <label htmlFor="admin-reset-email" className="block text-sm font-semibold">Email</label>
          <input
            id="admin-reset-email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.currentTarget.value)}
            className={inputClassName}
            data-testid="input-admin-reset-email"
            required
          />
        </div>
        {sent && (
          <p role="status" className="rounded-xl bg-[hsl(var(--primary))]/10 p-3 text-sm">
            If a staff account uses that address, check its inbox for recovery instructions.
          </p>
        )}
        {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
        <button
          disabled={pending || !email}
          className="w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 font-bold text-white disabled:opacity-50"
          data-testid="button-admin-reset-request"
        >
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
        <a href={adminLoginUrl} className="block text-center text-sm font-semibold text-[hsl(var(--primary))]">
          Return to Admin login
        </a>
      </form>
    </AdminAuthFrame>
  );
}

export function AdminResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(token ? '' : 'This Admin password reset link is invalid or malformed.');
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    if (password.length < 10 || password.length > 256) {
      setError('Choose a password between 10 and 256 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Those passwords do not match.');
      return;
    }
    setPending(true);
    setError('');
    try {
      await adminAuthRequest('password-reset/confirm', { token, password });
      setComplete(true);
      window.setTimeout(() => window.location.assign(adminLoginUrl), 900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'We could not reset your Admin password.');
    } finally {
      setPending(false);
    }
  };

  return (
    <AdminAuthFrame title={complete ? 'Password updated' : 'Choose a new Admin password'}>
      {complete ? (
        <p role="status" className="mt-6 rounded-xl bg-[hsl(var(--primary))]/10 p-4 text-sm">
          Your password was changed and your secure Admin session is ready.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-5">
          <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">
            Set a new password with at least 10 characters. This link can only be used once.
          </p>
          <div>
            <label htmlFor="admin-new-password" className="block text-sm font-semibold">New password</label>
            <input
              id="admin-new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
              className={inputClassName}
              data-testid="input-admin-new-password"
              required
            />
          </div>
          <div>
            <label htmlFor="admin-confirm-password" className="block text-sm font-semibold">Confirm new password</label>
            <input
              id="admin-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              className={inputClassName}
              data-testid="input-admin-confirm-password"
              required
            />
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-600">{error}</p>}
          <button
            disabled={pending || !token || !password || !confirmPassword}
            className="w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 font-bold text-white disabled:opacity-50"
            data-testid="button-admin-reset-confirm"
          >
            {pending ? 'Updating…' : 'Update password'}
          </button>
          <a href={adminLoginUrl} className="block text-center text-sm font-semibold text-[hsl(var(--primary))]">
            Return to Admin login
          </a>
        </form>
      )}
    </AdminAuthFrame>
  );
}