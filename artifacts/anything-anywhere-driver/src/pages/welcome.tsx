import { useState } from 'react';
import { useLocation } from 'wouter';
import { Mail, Lock, User as UserIcon, AlertTriangle } from 'lucide-react';
import { apiUrl } from '@/lib/api-url';
import { useDriverSession } from '@/lib/driver-session';

export default function Welcome() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading, isError, error, refetch, establishSession } = useDriverSession();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
  });
  const [authError, setAuthError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] px-6 pt-16" role="status" aria-label="Loading driver sign-in">
        <div className="mx-auto max-w-sm space-y-5">
          <div className="driver-skeleton mx-auto h-24 w-24 rounded-3xl" />
          <div className="driver-skeleton mx-auto h-16 w-56 rounded-2xl" />
          <div className="driver-skeleton mt-12 h-80 rounded-[20px]" />
        </div>
      </div>
    );
  }

  const destinationFor = (driver: NonNullable<typeof profile>) =>
    driver.approvalStatus === 'approved' ? '/' : '/onboarding';
  const handleContinue = () => {
    if (!profile) return;
    setLocation(destinationFor(profile));
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setIsSubmitting(true);

    try {
      const endpoint = mode === 'login' ? apiUrl('/api/auth/sign-in') : apiUrl('/api/auth/register');
      const body = mode === 'login'
        ? { email: formData.email, password: formData.password }
        : { ...formData, accountType: 'driver' };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Authentication failed');
      }

      // Check if they actually have driver privileges
       const profileRes = await fetch(apiUrl('/api/driver/profile'), { credentials: 'include' });
      if (!profileRes.ok) {
        throw new Error('Access Denied: Your account does not have driver privileges.');
      }
       const driver = await profileRes.json();
       establishSession(driver);
       setLocation(destinationFor(driver));

    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 text-center">
      <img src={`${import.meta.env.BASE_URL}lao-brand-mark.svg`} alt="" className="mb-4 h-28 w-28 object-contain drop-shadow-[0_14px_24px_rgba(255,74,0,.24)]" />
      <h1 className="font-display mb-3 text-5xl font-extrabold tracking-[-.065em] text-foreground md:text-6xl">Lao</h1>

      <div className="font-mono text-primary text-sm uppercase tracking-widest font-bold mb-12 flex items-center gap-3">
        <span className="w-8 h-px bg-primary/50" />
         Driver workspace
        <span className="w-8 h-px bg-primary/50" />
      </div>

      <div className="w-full max-w-sm space-y-4">
        {isError && ![401, 403].includes((error as { status?: number } | null)?.status || 0) ? (
          <div className="driver-card p-6" role="alert">
            <p className="font-bold">We could not check your driver session.</p>
            <p className="mt-2 text-sm text-muted-foreground">{(error as Error).message}</p>
            <button type="button" onClick={() => refetch()} className="driver-btn driver-btn-secondary mt-5 w-full">Try again</button>
          </div>
        ) : profile ? (
          <div className="space-y-4">
            <div className="driver-card p-4 bg-primary/10 border-primary/20 mb-6">
                <p className="font-mono text-xs uppercase tracking-widest text-primary mb-1">Signed in as</p>
              <p className="font-bold text-lg">{profile.firstName} {profile.lastName}</p>
            </div>

            <button
              onClick={handleContinue}
              className="driver-btn driver-btn-primary w-full"
              data-testid="button-enter-protocol"
            >
              Open driver app
            </button>
            {profile.approvalStatus === 'pending' && (
              <p className="text-muted-foreground text-sm font-medium mt-6">
                Application under review
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleAuth} className="driver-card p-6 space-y-4 text-left">
            <h2 className="font-display text-xl font-bold uppercase mb-4 text-center">
              {mode === 'login' ? 'Sign in' : 'Create driver account'}
            </h2>

            {authError && (
              <div className="bg-destructive/10 border border-destructive/20 text-destructive p-3 rounded-lg flex items-start gap-2 text-sm font-medium" role="alert">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            {mode === 'register' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">First Name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      className="w-full h-12 pl-10 pr-4 text-sm"
                      value={formData.firstName}
                      onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                      required
                      data-testid="input-first-name"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Last Name</label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      className="w-full h-12 pl-10 pr-4 text-sm"
                      value={formData.lastName}
                      onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                      required
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Email Address</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="email"
                  autoComplete="email"
                  className="w-full h-12 pl-10 pr-4 text-sm"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  required
                  data-testid="input-email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">Passcode</label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full h-12 pl-10 pr-4 text-sm"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={8}
                  data-testid="input-password"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="driver-btn driver-btn-primary w-full h-12 text-sm mt-2"
              data-testid="button-submit-auth"
            >
                {isSubmitting ? 'Signing you in…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <div className="text-center mt-4">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
                className="text-xs font-mono font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition-colors"
                data-testid="button-toggle-auth-mode"
              >
                {mode === 'login' ? 'Need an account? Join as a driver' : 'Already have an account? Sign in'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
