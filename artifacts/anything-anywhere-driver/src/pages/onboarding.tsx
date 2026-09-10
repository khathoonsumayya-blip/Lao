import { useState, useRef, useEffect } from 'react';
import { useLocation } from 'wouter';
import {
  useGetDriverOnboarding,
  useUpdateDriverOnboarding,
  getGetDriverOnboardingQueryKey,
  type DriverDocument,
  type DriverOnboardingInput,
  type DriverOnboardingInputVehicleType
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-url';
import { useDriverSession } from '@/lib/driver-session';
import { ArrowLeft, CheckCircle2, Clock, ChevronRight, UploadCloud, File as FileIcon, Loader2, LogOut } from 'lucide-react';

type DocType = 'driver_photo' | 'license' | 'insurance' | 'vehicle_registration';

function DocumentUploader({
  documentType,
  label,
  existingDoc,
  onSuccess
}: {
  documentType: DocType;
  label: string;
  existingDoc?: DriverDocument;
  onSuccess: () => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const needsExpiry = documentType !== 'driver_photo';
  const [expiryDate, setExpiryDate] = useState(existingDoc?.expiryDate?.slice(0, 10) || '');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError('File must be less than 10MB');
      return;
    }
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) {
      setError('Must be PDF, JPEG, or PNG');
      return;
    }
    if (needsExpiry && !expiryDate) {
      setError('Enter the document expiration date before uploading.');
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      // 1. Get presigned URL
      const resUrl = await fetch(apiUrl('/api/driver/documents/upload-url'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentType,
          name: file.name,
          size: file.size,
          contentType: file.type
        }),
        credentials: 'include'
      });

      if (!resUrl.ok) {
        const errorData = await resUrl.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to get upload URL');
      }

      const { uploadURL, objectPath } = await resUrl.json();

      // 2. Upload file directly to storage
      const resUpload = await fetch(uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      if (!resUpload.ok) throw new Error('Failed to upload file to storage');

      // 3. Confirm document record with backend
      const resConfirm = await fetch(apiUrl('/api/driver/documents'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentType, objectPath, ...(needsExpiry ? { expiryDate } : {}) }),
        credentials: 'include'
      });
      if (!resConfirm.ok) throw new Error('Failed to record document');

      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="driver-card p-4 border border-border bg-card">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-bold text-sm uppercase">{label}</h3>
          {existingDoc ? (
            <div className={`text-xs font-bold uppercase mt-1 ${
              existingDoc.verificationStatus === 'approved' ? 'text-emerald-500' :
              existingDoc.verificationStatus === 'rejected' ? 'text-destructive' :
              'text-primary'
            }`}>
              Status: {existingDoc.verificationStatus}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground uppercase font-bold mt-1">Missing</div>
          )}
        </div>
        {existingDoc && (
          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
            <FileIcon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>

      {error && <div className="text-xs text-destructive font-bold mb-3">{error}</div>}
      {needsExpiry && (
        <div className="mb-3">
          <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">
            Document Expiration Date
          </label>
          <input
            type="date"
            className="w-full h-12 px-3"
            value={expiryDate}
            onChange={(event) => {
              setExpiryDate(event.target.value);
              setError('');
            }}
            required
            disabled={isUploading}
            data-testid={`input-document-expiry-${documentType}`}
          />
        </div>
      )}

      <label className={`driver-btn w-full h-12 text-sm cursor-pointer ${
        existingDoc ? 'driver-btn-secondary' : 'driver-btn-primary'
      }`} data-testid={`button-upload-${documentType}`}>
        {isUploading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <div className="flex items-center gap-2">
            <UploadCloud className="w-4 h-4" />
            {existingDoc ? 'Update Document' : 'Upload Document'}
          </div>
        )}
        <input
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,application/pdf"
          onChange={handleFileChange}
          disabled={isUploading}
          data-testid={`input-file-${documentType}`}
        />
      </label>
    </div>
  );
}

const requiredDocs: { type: DocType; label: string }[] = [
  { type: 'license', label: "Driver's License" },
  { type: 'insurance', label: "Proof of Insurance" },
  { type: 'vehicle_registration', label: "Vehicle Registration" }
];

function OnboardingActions({
  onBack,
  onLogout,
  isLoggingOut,
}: {
  onBack: () => void;
  onLogout: () => void;
  isLoggingOut: boolean;
}) {
  const [location] = useLocation();
  const isStatus = location === '/status';

  return (
    <header className={`sticky z-20 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 pb-3 backdrop-blur ${isStatus ? 'top-[calc(3.5rem+env(safe-area-inset-top))] pt-3' : 'top-0 pt-[calc(0.75rem+env(safe-area-inset-top))]'}`}>
      <button
        type="button"
        onClick={onBack}
        className="driver-btn driver-btn-secondary h-11 min-w-0 px-4"
        data-testid="button-onboarding-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
      <button
        type="button"
        onClick={onLogout}
        disabled={isLoggingOut}
        className="driver-btn driver-btn-secondary h-11 min-w-0 px-4 text-destructive"
        data-testid="button-onboarding-logout"
      >
        {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        {isLoggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </header>
  );
}

export default function Onboarding() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { signOut } = useDriverSession();
  const { data: onboarding, isLoading, isError, error, refetch } = useGetDriverOnboarding();
  const updateOnboarding = useUpdateDriverOnboarding();
  const [saveMessage, setSaveMessage] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');

  const leaveOnboarding = () => {
    if (location === '/status') setLocation('/settings');
    else setLocation('/welcome', { replace: true });
  };
  const logout = async () => {
    setLogoutError('');
    setIsLoggingOut(true);
    try {
      await signOut();
      setLocation('/welcome', { replace: true });
    } catch (logoutFailure) {
      setLogoutError(logoutFailure instanceof Error ? logoutFailure.message : 'We could not sign you out. Please try again.');
      setIsLoggingOut(false);
    }
  };
  const actions = (
    <>
      <OnboardingActions onBack={leaveOnboarding} onLogout={() => void logout()} isLoggingOut={isLoggingOut} />
      {logoutError && <p className="mx-4 mt-3 text-sm font-semibold text-destructive" role="alert">{logoutError}</p>}
    </>
  );

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    licenseState: '',
    licenseLastFour: '',
    vehicleType: 'sedan' as DriverOnboardingInputVehicleType,
    vehicleMake: '',
    vehicleModel: '',
    vehicleColor: '',
    licensePlate: '',
    insuranceProvider: '',
    insuranceExpiresAt: '',
  });

  const initializedRef = useRef(false);

  useEffect(() => {
    if (onboarding?.profile && !initializedRef.current) {
      const saved = sessionStorage.getItem('driver-onboarding-draft');
      let draft: Partial<typeof formData> = {};
      try { draft = saved ? JSON.parse(saved) : {}; } catch { sessionStorage.removeItem('driver-onboarding-draft'); }
      setFormData({
        firstName: onboarding.profile.firstName || '',
        lastName: onboarding.profile.lastName || '',
        phone: onboarding.profile.phone || '',
        licenseState: onboarding.licenseState || '',
        licenseLastFour: onboarding.licenseLastFour || '',
        vehicleType: onboarding.vehicleType || 'sedan',
        vehicleMake: onboarding.vehicleMake || '',
        vehicleModel: onboarding.vehicleModel || '',
        vehicleColor: onboarding.vehicleColor || '',
        licensePlate: onboarding.licensePlate || '',
        insuranceProvider: onboarding.insuranceProvider || '',
        insuranceExpiresAt: onboarding.insuranceExpiresAt ? onboarding.insuranceExpiresAt.slice(0, 10) : '',
        ...draft,
      });
      initializedRef.current = true;
    }
  }, [onboarding]);

  useEffect(() => {
    if (initializedRef.current) sessionStorage.setItem('driver-onboarding-draft', JSON.stringify(formData));
  }, [formData]);

  if (isLoading) return <>{actions}<div className="p-6" role="status">Loading application…</div></>;
  if (isError || !onboarding) return <>{actions}<div className="p-6" role="alert">We could not load your application. <button className="underline" onClick={() => refetch()}>Try again</button><p className="mt-2 text-sm">{(error as Error | null)?.message}</p></div></>;

  const isPendingReview = onboarding?.onboardingStatus === 'submitted';
  const isApproved = onboarding?.onboardingStatus === 'approved';

  if (isApproved) {
    return (
      <><div>{actions}</div><div className="p-6 pt-16 text-center">
        <div className="w-20 h-20 bg-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h1 className="font-display text-3xl font-bold uppercase mb-4">Cleared for Duty</h1>
        <p className="text-muted-foreground mb-8">
          Your credentials and vehicle have been verified. You are now authorized to accept delivery offers.
        </p>
        <button
          onClick={() => setLocation('/')}
          className="driver-btn driver-btn-primary w-full"
          data-testid="button-start-driving"
        >
          Go to Route
        </button>
      </div></>
    );
  }

  if (isPendingReview) {
    return (
      <><div>{actions}</div><div className="p-6 pt-16 text-center">
        <div className="w-20 h-20 bg-secondary text-secondary-foreground rounded-full flex items-center justify-center mx-auto mb-6">
          <Clock className="w-10 h-10" />
        </div>
        <h1 className="font-display text-3xl font-bold uppercase mb-4">Under Review</h1>
        <p className="text-muted-foreground mb-8">
          Your application and documents are currently being processed by dispatch. Check back soon.
        </p>

        <div className="driver-card p-6 text-left mb-8 space-y-4">
          <div className="flex justify-between items-center pb-4 border-b border-border">
            <span className="font-mono text-sm uppercase text-muted-foreground">Background Check</span>
            <span className="font-bold text-sm text-primary uppercase">{onboarding.backgroundCheckStatus.replace('_', ' ')}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-mono text-sm uppercase text-muted-foreground">Document Status</span>
            <span className="font-bold text-sm text-primary uppercase">Pending</span>
          </div>
        </div>

        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() })}
          className="driver-btn driver-btn-secondary w-full"
          data-testid="button-refresh-status"
        >
          Refresh Status
        </button>
      </div></>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage('');
    setSubmissionError('');
    updateOnboarding.mutate({
      data: {
        ...formData,
        insuranceExpiresAt: formData.insuranceExpiresAt ? new Date(formData.insuranceExpiresAt).toISOString() : undefined,
        acknowledgeSafety: true
      }
    }, {
      onSuccess: () => {
        sessionStorage.removeItem('driver-onboarding-draft');
        queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() });
      },
      onError: (error) => setSubmissionError((error as { data?: { error?: string }; message?: string }).data?.error || (error as Error).message || 'We could not submit your application.')
    });
  };
  const saveProgress = () => {
    setSaveMessage('');
    setSubmissionError('');
    const data: DriverOnboardingInput = {
      acknowledgeSafety: false,
      ...(formData.firstName.trim() ? { firstName: formData.firstName.trim() } : {}),
      ...(formData.lastName.trim() ? { lastName: formData.lastName.trim() } : {}),
      ...(formData.phone.trim() ? { phone: formData.phone.trim() } : {}),
      ...(formData.licenseState.trim() ? { licenseState: formData.licenseState.trim() } : {}),
      ...(formData.licenseLastFour.trim() ? { licenseLastFour: formData.licenseLastFour.trim() } : {}),
      ...(formData.vehicleType ? { vehicleType: formData.vehicleType } : {}),
      ...(formData.vehicleMake.trim() ? { vehicleMake: formData.vehicleMake.trim() } : {}),
      ...(formData.vehicleModel.trim() ? { vehicleModel: formData.vehicleModel.trim() } : {}),
      ...(formData.vehicleColor.trim() ? { vehicleColor: formData.vehicleColor.trim() } : {}),
      ...(formData.licensePlate.trim() ? { licensePlate: formData.licensePlate.trim() } : {}),
      ...(formData.insuranceProvider.trim() ? { insuranceProvider: formData.insuranceProvider.trim() } : {}),
      ...(formData.insuranceExpiresAt ? { insuranceExpiresAt: new Date(formData.insuranceExpiresAt).toISOString() } : {}),
    };
    updateOnboarding.mutate({
      data,
    }, {
      onSuccess: () => {
        sessionStorage.removeItem('driver-onboarding-draft');
        setSaveMessage('Progress saved. You can safely return later.');
        void queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() });
      },
      onError: (error) => setSubmissionError((error as { data?: { error?: string }; message?: string }).data?.error || (error as Error).message || 'We could not save your progress.'),
    });
  };

  const requiredDocumentRecords = requiredDocs.map(doc => onboarding.documents.find(d => d.documentType === doc.type));
  const rejectedDocuments = requiredDocumentRecords.filter((doc): doc is DriverDocument => doc?.verificationStatus === 'rejected');
  const allDocsUploaded = requiredDocumentRecords.every(doc => doc && doc.verificationStatus !== 'rejected');

  return (
    <><div>{actions}</div><div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold uppercase mb-2">Driver Application</h1>
        <p className="text-muted-foreground">Complete your profile and upload credentials to join the active fleet.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-4">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary font-bold">Personal Protocol</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">First Name</label>
              <input
                type="text"
                className="w-full h-14 px-4 text-lg"
                value={formData.firstName}
                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                required
                data-testid="input-first-name"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Last Name</label>
              <input
                type="text"
                className="w-full h-14 px-4 text-lg"
                value={formData.lastName}
                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                required
                data-testid="input-last-name"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Mobile Number</label>
            <input
              type="tel"
              className="w-full h-14 px-4 text-lg"
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value })}
              required
              data-testid="input-phone"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">License State</label>
              <input
                type="text"
                maxLength={2}
                className="w-full h-14 px-4 text-lg uppercase"
                value={formData.licenseState}
                onChange={e => setFormData({ ...formData, licenseState: e.target.value.toUpperCase() })}
                required
                data-testid="input-license-state"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">License Last 4</label>
              <input
                type="text"
                maxLength={4}
                className="w-full h-14 px-4 text-lg"
                value={formData.licenseLastFour}
                onChange={e => setFormData({ ...formData, licenseLastFour: e.target.value.replace(/\D/g, '') })}
                required
                data-testid="input-license-last-four"
              />
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary font-bold">Vehicle Logistics</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Type</label>
              <select
                className="w-full h-14 px-4 text-lg"
                value={formData.vehicleType}
                onChange={e => setFormData({ ...formData, vehicleType: e.target.value as DriverOnboardingInputVehicleType })}
                required
                data-testid="input-vehicle-type"
              >
                <option value="sedan">Sedan</option>
                <option value="suv">SUV</option>
                <option value="van">Van</option>
                <option value="truck">Truck</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Color</label>
              <input
                type="text"
                className="w-full h-14 px-4 text-lg"
                value={formData.vehicleColor}
                onChange={e => setFormData({ ...formData, vehicleColor: e.target.value })}
                required
                data-testid="input-vehicle-color"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Make</label>
              <input
                type="text"
                className="w-full h-14 px-4 text-lg"
                value={formData.vehicleMake}
                onChange={e => setFormData({ ...formData, vehicleMake: e.target.value })}
                required
                data-testid="input-vehicle-make"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Model</label>
              <input
                type="text"
                className="w-full h-14 px-4 text-lg"
                value={formData.vehicleModel}
                onChange={e => setFormData({ ...formData, vehicleModel: e.target.value })}
                required
                data-testid="input-vehicle-model"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">License Plate</label>
            <input
              type="text"
              className="w-full h-14 px-4 text-lg uppercase"
              value={formData.licensePlate}
              onChange={e => setFormData({ ...formData, licensePlate: e.target.value.toUpperCase() })}
              required
              data-testid="input-license-plate"
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary font-bold">Insurance Protocol</h2>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Provider Name</label>
            <input
              type="text"
              className="w-full h-14 px-4 text-lg"
              value={formData.insuranceProvider}
              onChange={e => setFormData({ ...formData, insuranceProvider: e.target.value })}
              required
              data-testid="input-insurance-provider"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground uppercase mb-2">Expiration Date</label>
            <input
              type="date"
              className="w-full h-14 px-4 text-lg"
              value={formData.insuranceExpiresAt}
              onChange={e => setFormData({ ...formData, insuranceExpiresAt: e.target.value })}
              required
              data-testid="input-insurance-expires"
            />
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <h2 className="font-mono text-xs uppercase tracking-widest text-primary font-bold">Required Documents</h2>
          <div className="space-y-3">
            {requiredDocs.map(doc => (
              <DocumentUploader
                key={doc.type}
                documentType={doc.type}
                label={doc.label}
                existingDoc={onboarding?.documents?.find(d => d.documentType === doc.type)}
                onSuccess={() => queryClient.invalidateQueries({ queryKey: getGetDriverOnboardingQueryKey() })}
              />
            ))}
          </div>
        </div>

        <div className="pt-8">
          {!allDocsUploaded && (
            <p className="text-destructive text-sm font-bold mb-4 text-center">
               {rejectedDocuments.length ? 'Replace each rejected document before submitting again.' : 'Please upload all required documents to proceed.'}
            </p>
          )}
          {saveMessage && <p className="mb-4 text-center text-sm font-bold text-emerald-600" role="status">{saveMessage}</p>}
          {submissionError && <p className="mb-4 text-center text-sm font-bold text-destructive" role="alert">{submissionError}</p>}
          <button type="button" onClick={saveProgress} disabled={updateOnboarding.isPending} className="driver-btn driver-btn-secondary mb-3 w-full disabled:opacity-50" data-testid="button-save-onboarding-progress">Save Progress</button>
          <button
            type="submit"
            className="driver-btn driver-btn-primary w-full flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={updateOnboarding.isPending || !allDocsUploaded}
            data-testid="button-submit-application"
          >
            <span>Submit for Review</span>
            <ChevronRight className="w-6 h-6 opacity-70" />
          </button>
        </div>
      </form>
    </div></>
  );
}
