import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDriverOnboardingQueryKey,
  getGetDriverProfileQueryKey,
  type DriverDocument,
  type DriverProfileUpdate,
  type DriverProfileUpdateVehicleType,
  useGetDriverOnboarding,
  useUpdateDriverProfile,
} from '@workspace/api-client-react';
import { ArrowLeft, CheckCircle2, Loader2, UploadCloud, UserRound } from 'lucide-react';
import { apiUrl } from '@/lib/api-url';
import { useDriverSession } from '@/lib/driver-session';

type DocType = 'driver_photo' | 'license' | 'insurance' | 'vehicle_registration';
type FormValues = {
  firstName: string; lastName: string; phone: string; address: string; emergencyContactName: string; emergencyContactPhone: string; vehicleType: string; vehicleYear: string;
  vehicleMake: string; vehicleModel: string; vehicleColor: string; licensePlate: string;
  licenseState: string; licenseLastFour: string; insuranceProvider: string; insuranceExpiresAt: string;
};

const documentLabels: { type: DocType; label: string }[] = [
  { type: 'driver_photo', label: 'Driver photo' },
  { type: 'license', label: "Driver's license" },
  { type: 'insurance', label: 'Proof of insurance' },
  { type: 'vehicle_registration', label: 'Vehicle registration' },
];

function documentState(document?: DriverDocument) {
  if (!document) return 'missing';
  if (document.expiryDate && new Date(document.expiryDate).getTime() < Date.now()) return 'expired';
  return document.verificationStatus;
}

function ReplaceDocument({ documentType, document, onSuccess }: {
  documentType: DocType; document?: DriverDocument; onSuccess: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const needsExpiry = documentType !== 'driver_photo';
  const [expiryDate, setExpiryDate] = useState(document?.expiryDate?.slice(0, 10) || '');
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('File must be less than 10MB.'); return; }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) { setError('Use a PDF, JPEG, or PNG file.'); return; }
    if (needsExpiry && !expiryDate) { setError('Enter the document expiration date before replacing it.'); return; }
    setUploading(true); setError('');
    try {
      const signedUrl = await fetch(apiUrl('/api/driver/documents/upload-url'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, name: file.name, size: file.size, contentType: file.type }),
        credentials: 'include',
      });
      if (!signedUrl.ok) throw new Error((await signedUrl.json().catch(() => ({}))).message || 'Could not prepare your secure upload.');
      const { uploadURL, objectPath } = await signedUrl.json();
      const uploadResult = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploadResult.ok) throw new Error('Could not upload the document.');
      const record = await fetch(apiUrl('/api/driver/documents'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, objectPath, ...(needsExpiry ? { expiryDate } : {}) }), credentials: 'include',
      });
      if (!record.ok) throw new Error('Could not save the document record.');
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Document upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };
  return (
    <div>
      {error && <p className="mb-2 text-xs font-semibold text-destructive" role="alert">{error}</p>}
      {needsExpiry && <div className="mb-3"><label className="mb-1 block text-xs font-bold uppercase text-muted-foreground">Expiration date</label><input type="date" className="h-11 w-full px-3" value={expiryDate} onChange={(event) => { setExpiryDate(event.target.value); setError(''); }} required /></div>}
      <label className="driver-btn driver-btn-secondary h-11 cursor-pointer px-3 text-xs" data-testid={`button-replace-${documentType}`}>
        {uploading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
        {uploading ? 'Uploading…' : document ? 'Replace document' : 'Upload document'}
        <input className="hidden" type="file" accept="image/jpeg,image/png,application/pdf" disabled={uploading} onChange={upload} data-testid={`input-replace-${documentType}`} />
      </label>
    </div>
  );
}

export default function ProfileEdit() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: sessionProfile, isLoading: profileLoading } = useDriverSession();
  const { data: onboarding, isLoading: onboardingLoading, isError, error, refetch } = useGetDriverOnboarding();
  const updateProfile = useUpdateDriverProfile();
  const initialized = useRef(false);
  const [initial, setInitial] = useState<FormValues | null>(null);
  const [form, setForm] = useState<FormValues | null>(null);
  const [validationError, setValidationError] = useState('');
  const [apiError, setApiError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!onboarding || initialized.current) return;
    const next = {
      firstName: onboarding.profile.firstName || '', lastName: onboarding.profile.lastName || '', phone: onboarding.profile.phone || '',
      address: onboarding.profile.address || '', emergencyContactName: onboarding.profile.emergencyContactName || '', emergencyContactPhone: onboarding.profile.emergencyContactPhone || '',
      vehicleType: onboarding.vehicleType || '', vehicleMake: onboarding.vehicleMake || '', vehicleModel: onboarding.vehicleModel || '',
      vehicleColor: onboarding.vehicleColor || '', vehicleYear: onboarding.vehicleYear?.toString() || '', licensePlate: onboarding.licensePlate || '', licenseState: onboarding.licenseState || '',
      licenseLastFour: onboarding.licenseLastFour || '', insuranceProvider: onboarding.insuranceProvider || '',
      insuranceExpiresAt: onboarding.insuranceExpiresAt?.slice(0, 10) || '',
    };
    initialized.current = true; setInitial(next); setForm(next);
  }, [onboarding]);

  const isDirty = Boolean(form && initial && Object.keys(form).some((key) => form[key as keyof FormValues] !== initial[key as keyof FormValues]));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);
  useEffect(() => {
    const guardInAppNavigation = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (isDirty && link && !window.confirm('Discard your unsaved profile changes?')) event.preventDefault();
    };
    document.addEventListener('click', guardInAppNavigation, true);
    return () => document.removeEventListener('click', guardInAppNavigation, true);
  }, [isDirty]);

  const changed = useMemo(() => {
    if (!form || !initial) return {} as DriverProfileUpdate;
    const fields = Object.keys(form) as (keyof FormValues)[];
    return fields.reduce((result, field) => {
      if (form[field] === initial[field]) return result;
      const value = field === 'licensePlate' || field === 'licenseState' ? form[field].trim().toUpperCase() : form[field].trim();
      if (field === 'insuranceExpiresAt') return { ...result, insuranceExpiresAt: value ? new Date(value).toISOString() : undefined };
      if (field === 'vehicleYear') return { ...result, vehicleYear: value ? Number(value) : undefined };
      return { ...result, [field]: value } as DriverProfileUpdate;
    }, {} as DriverProfileUpdate);
  }, [form, initial]);

  const cancel = () => {
    if (isDirty && !window.confirm('Discard your unsaved profile changes?')) return;
    setLocation('/profile');
  };
  const change = (field: keyof FormValues, value: string) => {
    setSaved(false); setValidationError(''); setApiError('');
    setForm((current) => current ? { ...current, [field]: value } : current);
  };
  const save = (event: React.FormEvent) => {
    event.preventDefault(); setValidationError(''); setApiError(''); setSaved(false);
    if (!form || !initial || !Object.keys(changed).length) { setValidationError('Make a change before saving.'); return; }
    for (const field of ['firstName', 'lastName', 'address', 'emergencyContactName', 'vehicleMake', 'vehicleModel', 'vehicleColor', 'licensePlate', 'insuranceProvider'] as const) {
      if (field in changed && !form[field].trim()) { setValidationError(`${field.replace(/([A-Z])/g, ' $1')} cannot be blank.`); return; }
    }
    if ('phone' in changed && (form.phone.trim().length < 7 || form.phone.trim().length > 32)) { setValidationError('Enter a phone number between 7 and 32 characters.'); return; }
    if ('address' in changed && (form.address.trim().length < 3 || form.address.trim().length > 240)) { setValidationError('Enter an address between 3 and 240 characters.'); return; }
    if ('emergencyContactPhone' in changed && (form.emergencyContactPhone.trim().length < 7 || form.emergencyContactPhone.trim().length > 32)) { setValidationError('Enter an emergency phone number between 7 and 32 characters.'); return; }
    if ('vehicleYear' in changed && (!Number.isInteger(Number(form.vehicleYear)) || Number(form.vehicleYear) < 1990 || Number(form.vehicleYear) > 2100)) { setValidationError('Vehicle year must be a whole year from 1990 through 2100.'); return; }
    if ('licenseState' in changed && !/^[A-Za-z]{2}$/.test(form.licenseState.trim())) { setValidationError('License state must be two letters.'); return; }
    if ('licenseLastFour' in changed && !/^\d{4}$/.test(form.licenseLastFour.trim())) { setValidationError('License last four must be four digits.'); return; }
    updateProfile.mutate({ data: changed }, {
      onSuccess: (result) => {
        queryClient.setQueryData(getGetDriverProfileQueryKey(), result.profile);
        void queryClient.invalidateQueries({ queryKey: getGetDriverProfileQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() });
        setInitial(form); setSaved(true);
      },
      onError: (failure) => setApiError((failure as { data?: { error?: string }; message?: string }).data?.error || (failure as Error).message || 'We could not save your changes.'),
    });
  };

  if (profileLoading || onboardingLoading || !form) return <div className="p-6" role="status">Loading profile editor…</div>;
  if (isError || !onboarding || !sessionProfile) return <div className="p-6" role="alert">We could not load your profile. <button className="underline" onClick={() => refetch()}>Try again</button><p className="mt-2 text-sm">{(error as Error | null)?.message}</p></div>;
  const complianceChange = ['vehicleType', 'vehicleYear', 'vehicleMake', 'vehicleModel', 'vehicleColor', 'licensePlate', 'licenseState', 'licenseLastFour', 'insuranceProvider', 'insuranceExpiresAt'].some((field) => field in changed);

  return (
    <div className="px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-6 flex items-center gap-3">
        <button type="button" onClick={cancel} className="driver-btn driver-btn-secondary h-11 px-3" aria-label="Back to profile" data-testid="button-profile-edit-back"><ArrowLeft className="size-4" />Back</button>
        <div><h1 className="font-display text-2xl font-bold uppercase">Edit profile</h1><p className="text-sm text-muted-foreground">Keep your driver record current.</p></div>
      </header>
      <form onSubmit={save} className="space-y-6">
        <section className="driver-card space-y-4 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Personal information</h2>
          <div className="grid grid-cols-2 gap-3"><Field label="First name" value={form.firstName} onChange={(v) => change('firstName', v)} testId="input-edit-first-name" /><Field label="Last name" value={form.lastName} onChange={(v) => change('lastName', v)} testId="input-edit-last-name" /></div>
          <Field label="Mobile number" type="tel" value={form.phone} onChange={(v) => change('phone', v)} testId="input-edit-phone" />
          <Field label="Address" value={form.address} onChange={(v) => change('address', v)} testId="input-edit-address" />
          <div className="grid grid-cols-2 gap-3"><Field label="Emergency contact" value={form.emergencyContactName} onChange={(v) => change('emergencyContactName', v)} testId="input-edit-emergency-name" /><Field label="Emergency phone" type="tel" value={form.emergencyContactPhone} onChange={(v) => change('emergencyContactPhone', v)} testId="input-edit-emergency-phone" /></div>
          <div><label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">Email</label><input className="h-12 w-full px-3 opacity-70" value={sessionProfile.email} readOnly aria-describedby="email-managed" /><p id="email-managed" className="mt-1 text-xs text-muted-foreground">Email verification is managed by your sign-in account.</p></div>
          {(() => { const photo = onboarding.documents.find((document) => document.documentType === 'driver_photo'); return <div className="rounded-lg border border-border bg-secondary/20 p-3"><div className="mb-3 flex items-center gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><UserRound className="size-5" /></div><div><h3 className="text-sm font-bold uppercase">Private profile photo</h3><p className="text-xs text-muted-foreground">Photo {documentState(photo)}. It is kept private and is not shown from a public URL.</p></div></div><ReplaceDocument documentType="driver_photo" document={photo} onSuccess={() => void queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() })} /></div>; })()}
        </section>
        <section className="driver-card space-y-4 p-4">
          <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Vehicle & compliance</h2>
          <div className="grid grid-cols-2 gap-3"><SelectField label="Vehicle type" value={form.vehicleType} onChange={(v) => change('vehicleType', v)} /><Field label="Vehicle year" type="number" value={form.vehicleYear} onChange={(v) => change('vehicleYear', v.replace(/\D/g, ''))} /></div>
          <Field label="Vehicle color" value={form.vehicleColor} onChange={(v) => change('vehicleColor', v)} />
          <div className="grid grid-cols-2 gap-3"><Field label="Make" value={form.vehicleMake} onChange={(v) => change('vehicleMake', v)} /><Field label="Model" value={form.vehicleModel} onChange={(v) => change('vehicleModel', v)} /></div>
          <Field label="License plate" value={form.licensePlate} onChange={(v) => change('licensePlate', v.toUpperCase())} />
          <div className="grid grid-cols-2 gap-3"><Field label="License state" value={form.licenseState} onChange={(v) => change('licenseState', v.toUpperCase())} maxLength={2} /><Field label="License last 4" value={form.licenseLastFour} onChange={(v) => change('licenseLastFour', v.replace(/\D/g, ''))} maxLength={4} /></div>
          <Field label="Insurance provider" value={form.insuranceProvider} onChange={(v) => change('insuranceProvider', v)} /><Field label="Insurance expiration" type="date" value={form.insuranceExpiresAt} onChange={(v) => change('insuranceExpiresAt', v)} />
          {complianceChange && <p className="rounded-md bg-primary/10 p-3 text-sm font-medium text-primary">Vehicle, license, registration, and insurance changes require compliance review before they take effect.</p>}
        </section>
        <section className="driver-card space-y-3 p-4"><h2 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">Documents</h2>
          {documentLabels.filter(({ type }) => type !== 'driver_photo').map(({ type, label }) => { const doc = onboarding.documents.find((entry) => entry.documentType === type); const state = documentState(doc); return <div key={type} className="border-t border-border pt-3 first:border-t-0 first:pt-0"><div className="mb-2 flex items-start justify-between gap-3"><div><h3 className="text-sm font-bold uppercase">{label}</h3><p className="text-xs text-muted-foreground">{doc?.expiryDate ? `Expires ${new Date(doc.expiryDate).toLocaleDateString()}` : 'No expiration date on file.'}</p>{state === 'rejected' && <p className="mt-1 text-xs text-destructive">Rejected. {doc?.rejectionReason || 'No rejection reason was provided.'}</p>}</div><span className={`rounded px-2 py-1 text-xs font-bold uppercase ${state === 'approved' ? 'bg-emerald-500/20 text-emerald-600' : state === 'rejected' || state === 'expired' ? 'bg-destructive/15 text-destructive' : 'bg-primary/10 text-primary'}`}>{state}</span></div><ReplaceDocument documentType={type} document={doc} onSuccess={() => void queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() })} /></div>; })}
        </section>
        {validationError && <p className="text-sm font-semibold text-destructive" role="alert">{validationError}</p>}{apiError && <p className="text-sm font-semibold text-destructive" role="alert">{apiError}</p>}{saved && <p className="flex items-center gap-2 text-sm font-semibold text-emerald-600" role="status"><CheckCircle2 className="size-4" />Profile saved successfully.</p>}
        <div className="flex gap-3 pb-[env(safe-area-inset-bottom)]"><button type="button" onClick={cancel} disabled={updateProfile.isPending} className="driver-btn driver-btn-secondary h-12 flex-1">Cancel</button><button type="submit" disabled={updateProfile.isPending || !isDirty} className="driver-btn driver-btn-primary h-12 flex-1 disabled:opacity-50" data-testid="button-save-profile">{updateProfile.isPending ? <Loader2 className="size-4 animate-spin" /> : 'Save changes'}</button></div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', maxLength, testId }: { label: string; value: string; onChange: (value: string) => void; type?: string; maxLength?: number; testId?: string }) {
  return <div><label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">{label}</label><input type={type} maxLength={maxLength} className="h-12 w-full px-3" value={value} onChange={(event) => onChange(event.target.value)} data-testid={testId} /></div>;
}
function SelectField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><label className="mb-2 block text-xs font-bold uppercase text-muted-foreground">{label}</label><select className="h-12 w-full px-3" value={value} onChange={(event) => onChange(event.target.value as DriverProfileUpdateVehicleType)}><option value="">Not specified</option><option value="sedan">Sedan</option><option value="suv">SUV</option><option value="van">Van</option><option value="truck">Truck</option></select></div>;
}