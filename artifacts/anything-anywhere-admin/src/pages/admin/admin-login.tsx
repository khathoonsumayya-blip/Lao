import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiUrl } from '@/lib/api-url';
import '@/admin.css';

export function AdminLogin({ onSuccess }: { onSuccess: () => Promise<unknown> | unknown }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = formRef.current;
    const button = submitButtonRef.current;
    if (!form || !button) return;

    const updateButton = () => {
      const data = new FormData(form);
      button.disabled =
        !String(data.get('email') ?? '') ||
        !String(data.get('password') ?? '');
    };
    form.addEventListener('input', updateButton);
    updateButton();
    return () => form.removeEventListener('input', updateButton);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget as HTMLFormElement);
    const email = String(formData.get('email') ?? '');
    const password = String(formData.get('password') ?? '');
    setPending(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/auth/sign-in'), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, adminSession: true }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Incorrect email or password.');
      await onSuccess();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Login failed.'); } finally { setPending(false); }
  };
  const forgotPasswordUrl = `${import.meta.env.BASE_URL}forgot-password`;
  const inputClassName = 'aa-admin-login-input';
  return (
    <main className="aa-admin-theme aa-admin-login-page">
      <form ref={formRef} onSubmit={submit} className="aa-admin-login-form">
        <div className="aa-admin-login-brand" aria-label="Lao Admin">
          <img src={`${import.meta.env.BASE_URL}lao-brand-mark.svg`} alt="" />
          <span>Lao</span><small>Admin</small>
        </div>
        <div className="aa-admin-login-heading">
          <h1>Admin Login</h1>
          <p>Authorized staff only.</p>
        </div>
        <div className="aa-admin-login-field">
          <label htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            name="email"
            className={inputClassName}
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="name@company.com"
            data-testid="input-admin-email"
            required
          />
        </div>
        <div className="aa-admin-login-field">
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            name="password"
            className={inputClassName}
            type="password"
            autoComplete="current-password"
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            data-testid="input-admin-password"
            required
          />
        </div>
        {error && <p role="alert" className="aa-admin-login-error">{error}</p>}
        <button
          ref={submitButtonRef}
          data-testid="button-admin-login"
          type="submit"
          disabled
          className="aa-admin-login-button"
        >
          {pending ? 'Logging in…' : 'Log In'}
        </button>
        <a href={forgotPasswordUrl} className="aa-admin-login-link">
          Forgot password?
        </a>
      </form>
    </main>
  );
}