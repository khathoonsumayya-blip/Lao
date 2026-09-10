import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowLeft, ArrowRight, AtSign, CheckCircle2, Eye, EyeOff, LockKeyhole, MailCheck, Phone, ShieldCheck, UserRound } from 'lucide-react';
import { Logo, PrimaryButton } from '@/components/app-shell';
import { apiUrl } from '@/lib/api-url';
import { locationWithPresentationQuery } from '@/customer-entry-routing';

type AuthFormProps = {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  footer: React.ReactNode;
};

function AuthFrame({ title, eyebrow, children, footer }: AuthFormProps) {
  const showBack = !['/', '/welcome', '/sign-in'].includes(window.location.pathname);
  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] px-5 py-6 sm:grid sm:place-items-center sm:p-8">
      <div className="mx-auto w-full max-w-xl">
        {showBack && <Link href="/welcome" className="inline-flex items-center gap-2 text-sm font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"><ArrowLeft className="size-4" /> Back</Link>}
        <section className={`${showBack ? 'mt-6' : ''} overflow-hidden rounded-3xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft`}>
          <div className="p-6 sm:p-10">
            <div className="mb-8"><Logo /></div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[hsl(var(--accent))]">{eyebrow}</p>
            <h2 className="mt-3 font-display text-3xl font-extrabold tracking-[-.055em] text-[hsl(var(--primary))]">{title}</h2>
            {children}
            <div className="mt-7 border-t border-dashed border-[hsl(var(--border))] pt-5 text-center text-sm text-[hsl(var(--muted-foreground))]">{footer}</div>
          </div>
        </section>
      </div>
    </main>
  );
}

function FormField({ label, type = 'text', value, onChange, placeholder, icon: Icon, passwordVisible, onTogglePassword, autoComplete }: { label: string; type?: string; value: string; onChange: (value: string) => void; placeholder: string; icon?: typeof AtSign; passwordVisible?: boolean; onTogglePassword?: () => void; autoComplete?: string }) {
  const inputType = type === 'password' && passwordVisible ? 'text' : type;
  return <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</span><span className="relative block">{Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />}<input value={value} onChange={(event) => onChange(event.target.value)} type={inputType} autoComplete={autoComplete ?? (type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'name')} placeholder={placeholder} className="w-full rounded-xl border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-4 py-3 pr-12 text-sm font-medium text-[hsl(var(--primary))] outline-none placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--accent))] focus:ring-4 focus:ring-[hsl(var(--accent))]/10" style={Icon ? { paddingLeft: '2.6rem' } : undefined} />{onTogglePassword && <button type="button" onClick={onTogglePassword} aria-label={passwordVisible ? 'Hide password' : 'Show password'} className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--muted-foreground))]">{passwordVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>}</span></label>;
}

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

function presentationLocation(path: string) {
  return locationWithPresentationQuery(path, window.location.search);
}

export function WelcomePage() {
  return <SignInPage />;
}

export function SignUpPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const mobileDigits = phone.replace(/\D/g, '').length;
  const validPhone = /^[+().\s\d-]+$/.test(phone) && mobileDigits >= 10 && mobileDigits <= 15;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true); setError('');
    const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
    if (nameParts.length < 2) { setError('Enter your first and last name.'); setPending(false); return; }
    if (!validPhone) { setError('Enter a valid mobile number with 10 to 15 digits.'); setPending(false); return; }
    if (password.length < 10) { setError('Choose a password with at least 10 characters.'); setPending(false); return; }
    if (password !== confirmPassword) { setError('Your passwords do not match.'); setPending(false); return; }
    try {
      await authRequest('register', { firstName: nameParts[0], lastName: nameParts.slice(1).join(' '), email, phone, password });
      await queryClient.invalidateQueries({ queryKey: ['customer-auth-session'] });
      setLocation(presentationLocation('/'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'We could not create your account.');
    } finally { setPending(false); }
  };
  return <AuthFrame eyebrow="Create your account" title="Create your account." footer={<>Already have an account? <Link href="/sign-in" className="font-bold text-[hsl(var(--accent))]">Log in</Link></>}><form onSubmit={submit} className="mt-8 space-y-5"><FormField label="Full name" value={fullName} onChange={setFullName} placeholder="Morgan Lee" icon={UserRound} autoComplete="name" /><FormField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" icon={AtSign} /><FormField label="Phone number" type="tel" value={phone} onChange={setPhone} placeholder="(555) 010-0147" icon={Phone} autoComplete="tel" /><FormField label="Password" type="password" value={password} onChange={setPassword} placeholder="At least 10 characters" icon={LockKeyhole} passwordVisible={passwordVisible} onTogglePassword={() => setPasswordVisible((value) => !value)} autoComplete="new-password" /><FormField label="Confirm password" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat your password" icon={LockKeyhole} passwordVisible={confirmVisible} onTogglePassword={() => setConfirmVisible((value) => !value)} autoComplete="new-password" />{error && <p className="rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{error}</p>}<PrimaryButton disabled={pending || !fullName || !email || !phone || password.length < 10 || !confirmPassword} className="w-full">{pending ? 'Creating your account…' : 'Create account'} <ArrowRight className="size-4" /></PrimaryButton><p className="text-center text-xs leading-5 text-[hsl(var(--muted-foreground))]">By continuing, you agree to the customer terms and privacy policy.</p></form></AuthFrame>;
}

export function SignInPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setPending(true); setError('');
    try {
      const result = await authRequest('sign-in', { email, password });
      if (result.profile?.role !== 'customer') {
        await authRequest('signout', {});
        setError('This sign-in is for customer accounts. Please use the Driver or staff app for that account.');
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['customer-auth-session'] });
      setLocation(presentationLocation('/'));
    }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'We could not sign you in.'); }
    finally { setPending(false); }
  };
  return <AuthFrame eyebrow="Welcome back" title="Sign in to your desk." footer={<>New to Anything Anywhere? <Link href="/sign-up" className="font-bold text-[hsl(var(--accent))]">Create an account</Link></>}><form onSubmit={submit} className="mt-8 space-y-5"><FormField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" icon={AtSign} /><FormField label="Password" type="password" value={password} onChange={setPassword} placeholder="Your password" icon={LockKeyhole} passwordVisible={passwordVisible} onTogglePassword={() => setPasswordVisible((value) => !value)} /><div className="flex justify-end"><Link href="/forgot-password" className="text-sm font-bold text-[hsl(var(--accent))]">Forgot password?</Link></div>{error && <p className="rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]">{error}</p>}<PrimaryButton disabled={pending || !email || !password} className="w-full">{pending ? 'Signing in…' : 'Sign in'} <ArrowRight className="size-4" /></PrimaryButton></form></AuthFrame>;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const requestReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await authRequest('password-reset', { email });
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'We could not send recovery instructions.');
    } finally {
      setPending(false);
    }
  };
  return <AuthFrame eyebrow="Account recovery" title="Reset your password." footer={<Link href="/sign-in" className="font-bold text-[hsl(var(--accent))]">Return to sign in</Link>}><form onSubmit={requestReset} className="mt-8 space-y-5"><p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">Enter the email on your account. If it is registered, we’ll send a secure reset link that expires in 30 minutes.</p><FormField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" icon={AtSign} />{sent && <div className="flex gap-3 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm leading-6 text-[hsl(var(--primary))]" role="status"><MailCheck className="size-5 shrink-0 text-[hsl(var(--chart-2))]" />If an account uses that address, check its inbox for recovery instructions.</div>}{error && <p className="rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{error}</p>}<PrimaryButton disabled={pending || !email} className="w-full">{pending ? 'Sending…' : 'Send reset link'} <ArrowRight className="size-4" /></PrimaryButton></form></AuthFrame>;
}

export function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(token ? '' : 'This password reset link is invalid or malformed.');
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const submit = async (event: React.FormEvent) => {
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
      await authRequest('password-reset/confirm', { token, password });
      setComplete(true);
      setTimeout(() => setLocation(presentationLocation('/')), 900);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'We could not reset your password.');
    } finally {
      setPending(false);
    }
  };

  return <AuthFrame eyebrow="Account recovery" title={complete ? 'You’re back in.' : 'Choose a new password.'} footer={<Link href="/sign-in" className="font-bold text-[hsl(var(--accent))]">Return to sign in</Link>}>{complete ? <div className="mt-8 space-y-5"><div className="flex gap-3 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm leading-6 text-[hsl(var(--primary))]" role="status"><CheckCircle2 className="size-5 shrink-0 text-[hsl(var(--chart-2))]" />Your password was changed and your secure session is ready. Taking you to your delivery desk…</div></div> : <form onSubmit={submit} className="mt-8 space-y-5"><p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">Set a new password with at least 10 characters. This link can only be used once.</p><FormField label="New password" type="password" value={password} onChange={setPassword} placeholder="At least 10 characters" icon={LockKeyhole} passwordVisible={passwordVisible} onTogglePassword={() => setPasswordVisible((value) => !value)} autoComplete="new-password" /><FormField label="Confirm new password" type="password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Repeat your password" icon={LockKeyhole} passwordVisible={confirmVisible} onTogglePassword={() => setConfirmVisible((value) => !value)} autoComplete="new-password" />{error && <p className="rounded-xl bg-[hsl(var(--accent))]/10 p-3 text-sm font-semibold text-[hsl(var(--destructive))]" role="alert">{error}</p>}<PrimaryButton disabled={pending || !token || !password || !confirmPassword} className="w-full">{pending ? 'Updating password…' : 'Update password'} <ArrowRight className="size-4" /></PrimaryButton></form>}</AuthFrame>;
}

function VerificationPage({ phone = false }: { phone?: boolean }) {
  const [, setLocation] = useLocation();
  return <AuthFrame eyebrow={phone ? 'Phone verification' : 'Email verification'} title={phone ? 'Confirm your number.' : 'Check your inbox.'} footer={<Link href="/" className="font-bold text-[hsl(var(--accent))]">Return home</Link>}><div className="mt-8 space-y-5"><div className="grid size-14 place-items-center rounded-2xl bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]">{phone ? <Phone className="size-6" /> : <MailCheck className="size-6" />}</div><p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">{phone ? 'Phone verification will be available soon.' : 'Email verification will be available soon.'}</p><div className="rounded-xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--background))] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><CheckCircle2 className="mb-2 size-4 text-[hsl(var(--chart-2))]" />Your account remains protected while you use Anything Anywhere.</div><PrimaryButton onClick={() => setLocation(phone ? '/' : '/verify-phone')} className="w-full">{phone ? 'Continue' : 'Set up phone verification'} <ArrowRight className="size-4" /></PrimaryButton></div></AuthFrame>;
}

export function VerifyEmailPage() { return <VerificationPage />; }
export function VerifyPhonePage() { return <VerificationPage phone />; }
