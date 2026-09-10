import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetDriverSettings,
  useUpdateDriverSettings,
  getGetDriverSettingsQueryKey,
  type DriverSettingsUpdateNavigationApp,
  type DriverSettingsUpdatePreferredMaxRangeMiles,
  type DriverSettingsUpdateWorkingHours
} from '@workspace/api-client-react';
import { useDriverSession } from '@/lib/driver-session';
import {
  ArrowLeft, Bell, Car, CircleHelp, ClipboardCheck,
  LogOut, Map, User, Volume2, Vibrate, CheckCircle2,
  Loader2, Compass, ChevronRight, Lock, Wallet, CalendarClock, Globe
} from 'lucide-react';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

function SettingsLink({ href, icon: Icon, label }: { href: string, icon: any, label: string }) {
  return (
    <Link href={href} className="flex items-center gap-4 p-4 border-b border-border last:border-b-0 hover:bg-secondary/50 transition-colors">
      <div className="size-10 rounded-full bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
        <Icon className="size-5" />
      </div>
      <span className="flex-1 font-bold text-sm">{label}</span>
      <ChevronRight className="size-5 text-muted-foreground" />
    </Link>
  );
}

export default function Settings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { signOut } = useDriverSession();

  const { data: settings, isLoading, isError, refetch } = useGetDriverSettings();
  const updateSettings = useUpdateDriverSettings();

  const [notificationSound, setNotificationSound] = useState(true);
  const [vibration, setVibration] = useState(true);
  const [navigationApp, setNavigationApp] = useState<DriverSettingsUpdateNavigationApp>('system');
  const [preferredMaxRangeMiles, setPreferredMaxRangeMiles] = useState<DriverSettingsUpdatePreferredMaxRangeMiles>(5);

  const [workingHoursEnabled, setWorkingHoursEnabled] = useState(false);
  const [workingHours, setWorkingHours] = useState<DriverSettingsUpdateWorkingHours>({});

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  const initialized = useRef(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [appVersion, setAppVersion] = useState<string>('');

  useEffect(() => {
    // Attempt to get the Vite app version if available, otherwise just use a static string or default.
    setAppVersion(import.meta.env.VITE_APP_VERSION || '1.0.0');
  }, []);

  useEffect(() => {
    if (settings && !initialized.current) {
      setNotificationSound(settings.notificationSound);
      setVibration(settings.vibration);
      setNavigationApp(settings.navigationApp as DriverSettingsUpdateNavigationApp);
      setPreferredMaxRangeMiles(settings.preferredMaxRangeMiles as DriverSettingsUpdatePreferredMaxRangeMiles);
      setWorkingHoursEnabled(settings.workingHoursEnabled);
      setWorkingHours(settings.workingHours || {});
      initialized.current = true;
    }
  }, [settings]);

  const toggleDay = (day: string, enabled: boolean) => {
    setSaveMessage('');
    setWorkingHours(prev => {
      const next = { ...prev };
      if (enabled) {
        if (!next[day] || next[day].length === 0) {
          next[day] = [{ start: '09:00', end: '17:00' }];
        }
      } else {
        delete next[day];
      }
      return next;
    });
  };

  const updateDayRange = (day: string, start: string, end: string) => {
    setSaveMessage('');
    setWorkingHours(prev => ({
      ...prev,
      [day]: [{ start, end }]
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage('');
    setErrorMessage('');
    if (workingHoursEnabled && Object.keys(workingHours).length === 0) {
      setErrorMessage('Select at least one working day, or turn Working Hours off.');
      return;
    }

    updateSettings.mutate({
      data: {
        notificationSound,
        vibration,
        navigationApp,
        preferredMaxRangeMiles,
        workingHoursEnabled,
        workingHours,
      }
    }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetDriverSettingsQueryKey(), data);
        setSaveMessage('Preferences saved successfully.');
      },
      onError: (err: any) => {
        setErrorMessage(err.data?.error || err.message || 'Could not save preferences.');
      }
    });
  };

  const logout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await signOut();
      setLocation('/welcome', { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'We could not sign you out.');
      setLoggingOut(false);
    }
  };

  if (isLoading) return <div className="p-6 pt-16 text-center" role="status">Loading settings...</div>;
  if (isError || !settings) return <div className="p-6 pt-16 text-center" role="alert"><p className="mb-4">Could not load settings.</p><button onClick={() => refetch()} className="driver-btn driver-btn-primary">Try again</button></div>;

  return (
    <div className="p-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] space-y-6">
      <header className="mb-6 flex items-center gap-3">
        <button type="button" onClick={() => setLocation('/profile')} className="driver-btn driver-btn-secondary size-11 shrink-0 p-0" aria-label="Back to profile">
          <ArrowLeft className="size-5" />
        </button>
        <div>
          <h1 className="font-display text-2xl font-bold uppercase">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage preferences and account.</p>
        </div>
      </header>

      <section className="driver-card bg-card overflow-hidden">
        <div className="p-4 border-b border-border bg-secondary/20">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Account & Operations</h2>
        </div>
        <div className="flex flex-col">
          <SettingsLink href="/profile" icon={User} label="Driver Profile" />
          <SettingsLink href="/vehicle" icon={Car} label="Vehicle & Documents" />
          <SettingsLink href="/status" icon={ClipboardCheck} label="Onboarding Status" />
          <SettingsLink href="/earnings" icon={Wallet} label="Earnings & Payouts" />
          <SettingsLink href="/notifications" icon={Bell} label="Notifications" />
          <SettingsLink href="/help" icon={CircleHelp} label="Help & Support" />
        </div>
      </section>

      <form onSubmit={handleSave} className="driver-card p-5 space-y-6 bg-card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">App Preferences</h2>
          {updateSettings.isPending && <Loader2 className="size-4 animate-spin text-primary" />}
        </div>

        <div className="space-y-5">
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <div className="flex-1">
              <span className="text-sm font-bold flex items-center gap-2"><Volume2 className="size-4 text-muted-foreground" /> Notification Sound</span>
              <span className="text-xs text-muted-foreground block mt-1">Play an alert when a new delivery is offered. (May be blocked by device silent mode or browser auto-play policies.)</span>
            </div>
            <input type="checkbox" className="size-5 accent-primary shrink-0" checked={notificationSound} onChange={e => { setNotificationSound(e.target.checked); setSaveMessage(''); }} />
          </label>

          <label className="flex items-center justify-between gap-4 cursor-pointer pt-4 border-t border-border">
            <div className="flex-1">
              <span className="text-sm font-bold flex items-center gap-2"><Vibrate className="size-4 text-muted-foreground" /> Haptic Feedback</span>
              <span className="text-xs text-muted-foreground block mt-1">Vibrate the device for important alerts. (Requires hardware support. Not available on all devices/browsers.)</span>
            </div>
            <input type="checkbox" className="size-5 accent-primary shrink-0" checked={vibration} onChange={e => { setVibration(e.target.checked); setSaveMessage(''); }} />
          </label>

          <div className="pt-4 border-t border-border">
            <label className="block text-sm font-bold mb-3 flex items-center gap-2"><Compass className="size-4 text-muted-foreground" /> Navigation App</label>
            <select
              className="w-full h-12 px-3 border border-border bg-secondary/20 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary outline-none"
              value={navigationApp}
              onChange={e => { setNavigationApp(e.target.value as DriverSettingsUpdateNavigationApp); setSaveMessage(''); }}
            >
              <option value="system">System Default</option>
              <option value="google_maps">Google Maps</option>
              <option value="apple_maps">Apple Maps</option>
              <option value="waze">Waze</option>
            </select>
          </div>

          <div className="pt-4 border-t border-border">
            <label className="block text-sm font-bold mb-3 flex items-center gap-2"><Map className="size-4 text-muted-foreground" /> Preferred Range</label>
            <select
              className="w-full h-12 px-3 border border-border bg-secondary/20 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary outline-none"
              value={preferredMaxRangeMiles}
              onChange={e => { setPreferredMaxRangeMiles(Number(e.target.value) as DriverSettingsUpdatePreferredMaxRangeMiles); setSaveMessage(''); }}
            >
              <option value={3}>3 Miles (Local Only)</option>
              <option value={5}>5 Miles (Standard)</option>
              <option value={8}>8 Miles (Extended)</option>
              <option value={12}>12 Miles (Maximum)</option>
            </select>
            <p className="text-[11px] font-medium text-muted-foreground mt-2 uppercase tracking-wide">Offers beyond this maximum range are excluded. Administrative or system caps may further reduce your actual range.</p>
          </div>

          <div className="pt-4 border-t border-border">
            <label className="flex items-center justify-between gap-4 cursor-pointer mb-3">
              <div className="flex-1">
                <span className="text-sm font-bold flex items-center gap-2"><CalendarClock className="size-4 text-muted-foreground" /> Working Hours</span>
                <span className="text-xs text-muted-foreground block mt-1">Only receive offers during specific times.</span>
              </div>
              <input type="checkbox" className="size-5 accent-primary shrink-0" checked={workingHoursEnabled} onChange={e => { setWorkingHoursEnabled(e.target.checked); setSaveMessage(''); }} />
            </label>

            {workingHoursEnabled && (
              <div className="space-y-3 mt-4 border border-border rounded-xl p-3 bg-secondary/10">
                <div className="flex items-center gap-2 mb-2 text-xs font-bold text-muted-foreground">
                  <Globe className="size-3" /> Timezone: {settings.timeZone}
                </div>
                {DAYS.map(day => {
                  const hasHours = !!workingHours[day] && workingHours[day].length > 0;
                  const range = hasHours ? workingHours[day][0] : { start: '09:00', end: '17:00' };

                  return (
                    <div key={day} className="flex flex-col gap-2 pb-3 mb-3 border-b border-border/50 last:mb-0 last:pb-0 last:border-0">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input type="checkbox" className="size-4 accent-primary" checked={hasHours} onChange={e => toggleDay(day, e.target.checked)} />
                        <span className="text-sm font-bold capitalize">{day}</span>
                      </label>
                      {hasHours && (
                        <div className="flex items-center gap-2 pl-7">
                          <input
                            type="time"
                            className="h-10 px-2 flex-1 text-sm border border-border rounded-lg bg-background"
                            value={range.start}
                            onChange={e => updateDayRange(day, e.target.value, range.end)}
                          />
                          <span className="text-muted-foreground text-xs">to</span>
                          <input
                            type="time"
                            className="h-10 px-2 flex-1 text-sm border border-border rounded-lg bg-background"
                            value={range.end}
                            onChange={e => updateDayRange(day, range.start, e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="pt-5 border-t border-border">
          {saveMessage && <p className="mb-3 text-sm font-bold text-emerald-500 flex items-center gap-2" role="status"><CheckCircle2 className="size-4" /> {saveMessage}</p>}
          {errorMessage && <p className="mb-3 text-sm font-bold text-destructive" role="alert">{errorMessage}</p>}
          <button
            type="submit"
            className="driver-btn driver-btn-primary w-full h-12"
            disabled={updateSettings.isPending}
          >
            {updateSettings.isPending ? <Loader2 className="size-5 animate-spin" /> : 'Save Preferences'}
          </button>
        </div>
      </form>

      <section className="driver-card p-5 space-y-4 bg-card">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Live Location Tracking</h2>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-bold flex items-center gap-2"><Map className="size-4 text-muted-foreground" /> Location Permission</p>
            <p className="text-xs text-muted-foreground mt-1">Managed by your browser or device settings. Required while online.</p>
          </div>
          <div className="text-right shrink-0">
            {settings.location.status === 'fresh' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded">Active</span>
            ) : settings.location.status === 'stale' ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-1 rounded">Stale</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-destructive bg-destructive/10 px-2 py-1 rounded">Unavailable</span>
            )}
          </div>
        </div>
        {settings.location.lastUpdatedAt && (
          <p className="text-[10px] uppercase font-mono text-muted-foreground">Last updated: {new Date(settings.location.lastUpdatedAt).toLocaleString()}</p>
        )}
      </section>

      <section className="driver-card p-5 space-y-4 bg-card">
        <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Security & Payments</h2>
        <div className="pb-2">
          <p className="text-sm font-bold flex items-center gap-2"><Wallet className="size-4 text-muted-foreground" /> Payout Destination</p>
          <p className="text-xs text-muted-foreground mt-2">Bank details and payout destinations are currently managed directly by Dispatch. Contact support if you need to update your payment information.</p>
        </div>
        <div className="pb-2 pt-2 border-t border-border">
          <p className="text-sm font-bold flex items-center gap-2"><Lock className="size-4 text-muted-foreground" /> Password & Authentication</p>
          <p className="text-xs text-muted-foreground mt-2">Your authentication is managed securely through the sign-in flow. Note: There is currently no automated forgot-password recovery. Contact support if you lose access to your account.</p>
        </div>
        {logoutError && <p className="text-sm font-bold text-destructive" role="alert">{logoutError}</p>}
        <button
          onClick={logout}
          disabled={loggingOut}
          className="driver-btn driver-btn-secondary w-full text-destructive border-destructive/20 hover:bg-destructive/10 h-12 gap-2"
        >
          {loggingOut ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}
          {loggingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </section>

      <section className="text-center py-6">
        <p className="font-display font-bold uppercase text-lg mb-1 tracking-widest">Lao Driver</p>
        <p className="text-[10px] text-muted-foreground font-mono uppercase mb-4 tracking-widest">Version {appVersion} (Stable)</p>
        <div className="flex items-center justify-center gap-4 text-xs font-bold text-muted-foreground">
          <span className="text-muted-foreground/70">Privacy Policy (Managed by Support)</span>
          <span className="text-border">&bull;</span>
          <span className="text-muted-foreground/70">Terms of Service (Managed by Support)</span>
        </div>
        <p className="text-[10px] text-muted-foreground mt-4 max-w-xs mx-auto">
          Legal documents, terms, and policies are managed offline by Dispatch.
        </p>
      </section>
    </div>
  );
}
