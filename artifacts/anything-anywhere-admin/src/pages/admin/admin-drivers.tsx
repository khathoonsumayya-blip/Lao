import {
  useListAdminDriverReview,
  useGetAdminDriverReview,
  useDecideAdminDriver,
  useReviewAdminDriverDocument,
  useCreateAdminDriverDocumentDownloadUrl,
  useAdjudicateAdminDriverBackgroundCheck,
  useAdjudicateAdminDriverMvr,
  useReviewAdminDriverProfileUpdate,
  getGetAdminDriverReviewQueryKey,
  getListAdminDriverReviewQueryKey,
} from '@workspace/api-client-react';
import type {
  DriverCheckAdjudicationInputStatus,
  DriverVerificationIncomplete,
  PendingDriverProfileChanges,
} from '@workspace/api-client-react';
import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AdminLayout } from './admin-layout';
import { Loader2, RefreshCcw, CheckCircle, XCircle, AlertCircle, Clock, Download, Search, Car, User } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogHeader } from '@/components/ui/dialog';

const formatDate = (date?: string | null) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString();
};

const formatTime = (date?: string | null) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString();
};

function verificationError(error: unknown): DriverVerificationIncomplete | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null;
  const data = error.data;
  if (!data || typeof data !== 'object' || !('error' in data) || !('requirements' in data)) return null;
  if (typeof data.error !== 'string' || !Array.isArray(data.requirements)) return null;
  return data as DriverVerificationIncomplete;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string, text: string, icon: any }> = {
    pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', icon: Clock },
    approved: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle },
    rejected: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', icon: XCircle },
    suspended: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', icon: AlertCircle },
    clear: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-400', icon: CheckCircle },
    review: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400', icon: AlertCircle },
    not_started: { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400', icon: Clock },
  };
  const config = map[status?.toLowerCase()] || { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400', icon: AlertCircle };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${config.bg} ${config.text}`}>
      <Icon className="w-3 h-3" />
      {status ? status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ') : 'Unknown'}
    </span>
  );
}

const profileChangeLabels: Record<keyof PendingDriverProfileChanges, string> = {
  vehicleType: 'Vehicle type',
  vehicleYear: 'Vehicle year',
  vehicleMake: 'Vehicle make',
  vehicleModel: 'Vehicle model',
  vehicleColor: 'Vehicle color',
  licensePlate: 'License plate',
  licenseState: 'License state',
  licenseLastFour: 'License last four',
  insuranceProvider: 'Insurance provider',
  insuranceExpiresAt: 'Insurance expiry',
};

function profileValue(value: string | number | null | undefined, field: keyof PendingDriverProfileChanges): string {
  if (!value) return 'Not provided';
  return field === 'insuranceExpiresAt' && typeof value === 'string' ? formatDate(value) : String(value);
}

function DriverReviewModal({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: reviewData, isLoading, isError, refetch } = useGetAdminDriverReview(id, {
    query: {
      enabled: !!id,
      queryKey: getGetAdminDriverReviewQueryKey(id),
    }
  });

  const decide = useDecideAdminDriver();
  const reviewDoc = useReviewAdminDriverDocument();
  const downloadDoc = useCreateAdminDriverDocumentDownloadUrl();
  const adjBg = useAdjudicateAdminDriverBackgroundCheck();
  const adjMvr = useAdjudicateAdminDriverMvr();
  const reviewProfileUpdate = useReviewAdminDriverProfileUpdate();

  const [rejectReason, setRejectReason] = useState('');
  const [docRejectReason, setDocRejectReason] = useState<Record<string, string>>({});
  const [bgStatus, setBgStatus] = useState<DriverCheckAdjudicationInputStatus>('clear');
  const [bgReason, setBgReason] = useState('');
  const [bgRef, setBgRef] = useState('');

  const [mvrStatus, setMvrStatus] = useState<DriverCheckAdjudicationInputStatus>('clear');
  const [mvrReason, setMvrReason] = useState('');
  const [mvrRef, setMvrRef] = useState('');
  const [profileRejectReason, setProfileRejectReason] = useState('');

  const [decisionError, setDecisionError] = useState<DriverVerificationIncomplete | { error: string } | null>(null);

  if (isLoading) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[700px] h-[80vh] flex flex-col items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--primary))]" />
          <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">Loading driver details...</p>
        </DialogContent>
      </Dialog>
    );
  }

  if (isError || !reviewData) {
    return (
      <Dialog open={true} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[700px]">
          <div className="flex flex-col items-center justify-center py-10">
            <AlertCircle className="h-10 w-10 text-red-500 mb-4" />
            <h2 className="text-lg font-bold">Failed to load driver details</h2>
            <button onClick={() => refetch()} className="mt-4 flex items-center gap-2 rounded bg-[hsl(var(--primary))] px-4 py-2 text-white font-semibold">
              <RefreshCcw className="h-4 w-4" /> Retry
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const driver = reviewData.driver;
  const application = reviewData.application;
  const documents = reviewData.documents;

  const handleDecision = async (decision: 'approved' | 'rejected' | 'suspended') => {
    setDecisionError(null);
    if ((decision === 'rejected' || decision === 'suspended') && rejectReason.trim().length < 3) {
      setDecisionError({ error: `A reason is required for ${decision}.` });
      return;
    }
    try {
      await decide.mutateAsync({ id, data: { decision, reason: rejectReason } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminDriverReviewQueryKey() }),
        refetch()
      ]);
      if (decision === 'approved') onClose();
    } catch (err: unknown) {
      setDecisionError(verificationError(err) ?? { error: errorMessage(err, 'Failed to apply decision.') });
    }
  };

  const handleDocReview = async (docId: string, decision: 'approved' | 'rejected') => {
    const reason = docRejectReason[docId] || '';
    if (decision === 'rejected' && reason.trim().length < 3) {
      window.alert('Reason is required to reject document.');
      return;
    }
    try {
      await reviewDoc.mutateAsync({ id: docId, data: { decision, reason } });
      refetch();
    } catch (e: unknown) {
      window.alert(errorMessage(e, 'Failed to review document.'));
    }
  };

  const handleDocDownload = async (docId: string) => {
    try {
      const res = await downloadDoc.mutateAsync({ id: docId });
      if (res?.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e: unknown) {
      window.alert(errorMessage(e, 'Failed to generate download URL.'));
    }
  };

  const handleAdjudicateBg = async () => {
    try {
      await adjBg.mutateAsync({ id, data: { status: bgStatus, reason: bgReason || undefined, reference: bgRef || undefined } });
      refetch();
    } catch (e: unknown) {
      window.alert(errorMessage(e, 'Failed to adjudicate background check.'));
    }
  };

  const handleAdjudicateMvr = async () => {
    try {
      await adjMvr.mutateAsync({ id, data: { status: mvrStatus, reason: mvrReason || undefined, reference: mvrRef || undefined } });
      refetch();
    } catch (e: unknown) {
      window.alert(errorMessage(e, 'Failed to adjudicate MVR.'));
    }
  };

  const reqDocTypes = ['license', 'insurance', 'vehicle_registration'];
  const pendingChanges = reviewData.pendingProfileChanges;
  const isPendingProfileReview = reviewData.complianceReviewStatus === 'pending' && !!pendingChanges;
  const profileChangeRows = pendingChanges
    ? (Object.keys(profileChangeLabels) as Array<keyof PendingDriverProfileChanges>)
      .filter((field) => field in pendingChanges)
      .map((field) => {
        const approvedValues: Record<keyof PendingDriverProfileChanges, string | number | null | undefined> = {
          vehicleType: driver.vehicleType,
          vehicleYear: driver.vehicleYear,
          vehicleMake: driver.vehicleMake,
          vehicleModel: driver.vehicleModel,
          vehicleColor: driver.vehicleColor,
          licensePlate: driver.licensePlate,
          licenseState: application?.licenseState,
          licenseLastFour: application?.licenseLastFour,
          insuranceProvider: application?.insuranceProvider,
          insuranceExpiresAt: application?.insuranceExpiresAt,
        };
        return { field, approved: approvedValues[field], requested: pendingChanges[field] };
      })
    : [];

  const handleProfileReview = async (decision: 'approved' | 'rejected') => {
    setDecisionError(null);
    const reason = profileRejectReason.trim();
    if (decision === 'rejected' && reason.length < 3) {
      setDecisionError({ error: 'A reason is required to reject a profile update.' });
      return;
    }
    try {
      await reviewProfileUpdate.mutateAsync({
        id,
        data: { decision, ...(decision === 'rejected' ? { reason } : {}) },
      });
      setProfileRejectReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListAdminDriverReviewQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetAdminDriverReviewQueryKey(id) }),
        refetch(),
      ]);
    } catch (error: unknown) {
      setDecisionError({ error: errorMessage(error, 'Failed to review profile update.') });
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[800px] h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b bg-[hsl(var(--muted)/0.3)]">
          <DialogTitle className="text-xl flex items-center gap-3">
            {driver.firstName} {driver.lastName}
            <StatusBadge status={driver.approvalStatus} />
          </DialogTitle>
          <DialogDescription>
            {driver.email} {driver.phone && `· ${driver.phone}`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {decisionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/50 dark:bg-red-900/20">
              <div className="flex gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 text-red-600 dark:text-red-400" />
                <div>
                  <h3 className="text-sm font-bold text-red-800 dark:text-red-300">{decisionError.error}</h3>
                  {'requirements' in decisionError && decisionError.requirements.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-sm text-red-700 dark:text-red-400">
                      {decisionError.requirements.map((requirement) => (
                        <li key={requirement.code}>{requirement.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {isPendingProfileReview && (
            <section data-testid="section-pending-profile-review">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Pending Compliance Profile Update</h3>
                  <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid="text-profile-update-submitted">
                    Submitted {formatTime(reviewData.pendingProfileSubmittedAt)}
                  </p>
                </div>
                <StatusBadge status={reviewData.complianceReviewStatus} />
              </div>
              <div className="overflow-hidden rounded-xl border bg-[hsl(var(--card))]">
                <div className="grid grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b bg-[hsl(var(--muted)/0.3)] px-4 py-2 text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                  <span>Field</span><span>Approved</span><span>Requested</span>
                </div>
                {profileChangeRows.map(({ field, approved, requested }) => (
                  <div key={field} className="grid grid-cols-[minmax(100px,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b px-4 py-3 text-sm last:border-b-0">
                    <span className="font-medium">{profileChangeLabels[field]}</span>
                    <span className="break-words text-[hsl(var(--muted-foreground))]" data-testid={`text-profile-approved-${field}`}>{profileValue(approved, field)}</span>
                    <span className="break-words font-medium" data-testid={`text-profile-requested-${field}`}>{profileValue(requested, field)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  className="min-w-[220px] flex-1 rounded-lg border bg-[hsl(var(--background))] px-3 py-2 text-sm"
                  placeholder="Rejection reason (required)"
                  value={profileRejectReason}
                  onChange={(event) => setProfileRejectReason(event.target.value)}
                  disabled={reviewProfileUpdate.isPending}
                  data-testid="input-profile-update-rejection-reason"
                />
                <button
                  onClick={() => handleProfileReview('rejected')}
                  disabled={reviewProfileUpdate.isPending}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  data-testid="button-reject-profile-update"
                >
                  {reviewProfileUpdate.isPending ? 'Submitting...' : 'Reject Update'}
                </button>
                <button
                  onClick={() => handleProfileReview('approved')}
                  disabled={reviewProfileUpdate.isPending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                  data-testid="button-approve-profile-update"
                >
                  {reviewProfileUpdate.isPending ? 'Submitting...' : 'Approve Update'}
                </button>
              </div>
            </section>
          )}

          <section>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">Application Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm bg-[hsl(var(--card))] border rounded-xl p-4">
              <div>
                <span className="text-[hsl(var(--muted-foreground))] block text-xs">Vehicle</span>
                 <span className="font-medium">{[driver.vehicleColor, driver.vehicleMake, driver.vehicleModel].filter(Boolean).join(' ') || driver.vehicleType || 'Not specified'}</span>
              </div>
              <div>
                <span className="text-[hsl(var(--muted-foreground))] block text-xs">Submitted At</span>
                 <span className="font-medium">{formatTime(application?.submittedAt)}</span>
              </div>
              <div>
                <span className="text-[hsl(var(--muted-foreground))] block text-xs">License State & Last 4</span>
                 <span className="font-medium">{application?.licenseState || '--'} · {application?.licenseLastFour || '----'}</span>
              </div>
              <div>
                <span className="text-[hsl(var(--muted-foreground))] block text-xs">Insurance Provider & Expiry</span>
                 <span className="font-medium">{application?.insuranceProvider || '--'} · {formatDate(application?.insuranceExpiresAt)}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">Required Documents</h3>
            <div className="space-y-3">
              {reqDocTypes.map(type => {
                 const doc = documents.find((document) => document.documentType === type);
                if (!doc) {
                  return (
                    <div key={type} className="flex items-center justify-between p-3 border rounded-xl border-dashed bg-[hsl(var(--muted)/0.2)]">
                      <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-[hsl(var(--muted-foreground))]" />
                        <div>
                          <p className="text-sm font-medium capitalize">{type.replace('_', ' ')}</p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">Missing</p>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={doc.id} className="p-4 border rounded-xl bg-[hsl(var(--card))]">
                    <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium capitalize">{type.replace('_', ' ')}</p>
                          <StatusBadge status={doc.verificationStatus} />
                        </div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Expires: {formatDate(doc.expiryDate)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDocDownload(doc.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] hover:bg-[hsl(var(--secondary)/0.8)]"
                          disabled={downloadDoc.isPending}
                        >
                          <Download className="w-3.5 h-3.5" /> View
                        </button>
                      </div>
                    </div>
                    {doc.verificationStatus === 'pending' && (
                      <div className="flex flex-wrap gap-2 pt-3 border-t">
                        <button
                          onClick={() => handleDocReview(doc.id, 'approved')}
                          className="px-3 py-1.5 text-xs font-bold rounded bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400"
                          disabled={reviewDoc.isPending}
                        >
                          Approve Doc
                        </button>
                        <div className="flex-1 flex gap-2 min-w-[200px]">
                          <input
                            placeholder="Rejection reason..."
                            value={docRejectReason[doc.id] || ''}
                            onChange={(e) => setDocRejectReason({ ...docRejectReason, [doc.id]: e.target.value })}
                            className="flex-1 px-2 py-1.5 text-xs border rounded bg-[hsl(var(--background))]"
                          />
                          <button
                            onClick={() => handleDocReview(doc.id, 'rejected')}
                            className="px-3 py-1.5 text-xs font-bold rounded bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:text-red-400"
                            disabled={reviewDoc.isPending}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] mb-3">Checks & Screenings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border rounded-xl p-4 bg-[hsl(var(--card))]">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold text-sm">Background Check</span>
                   <StatusBadge status={application?.backgroundCheckStatus ?? 'not_started'} />
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mb-4 space-y-1">
                   <p>Ref: {application?.backgroundCheckReference || 'None'}</p>
                   <p>Updated: {formatTime(application?.backgroundCheckedAt)}</p>
                   {application?.backgroundCheckReason && <p>Reason: {application.backgroundCheckReason}</p>}
                </div>
                <div className="pt-3 border-t space-y-2">
                  <div className="flex gap-2">
                    <select
                      className="flex-1 text-sm border rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      value={bgStatus}
                      onChange={(e) => setBgStatus(e.target.value as DriverCheckAdjudicationInputStatus)}
                    >
                      <option value="clear">Clear</option>
                      <option value="review">Needs Review</option>
                      <option value="pending">Pending</option>
                    </select>
                    <input
                      placeholder="Ref ID"
                      className="w-24 text-sm border rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      value={bgRef}
                      onChange={(e) => setBgRef(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Notes / Reason..."
                      className="flex-1 text-sm border rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      value={bgReason}
                      onChange={(e) => setBgReason(e.target.value)}
                    />
                    <button
                      onClick={handleAdjudicateBg}
                      disabled={adjBg.isPending}
                      className="px-3 py-1.5 text-sm font-semibold bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] rounded"
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>

              <div className="border rounded-xl p-4 bg-[hsl(var(--card))]">
                <div className="flex justify-between items-start mb-2">
                  <span className="font-semibold text-sm">MVR Check</span>
                   <StatusBadge status={application?.mvrCheckStatus ?? 'not_started'} />
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))] mb-4 space-y-1">
                   <p>Ref: {application?.mvrCheckReference || 'None'}</p>
                   <p>Updated: {formatTime(application?.mvrCheckedAt)}</p>
                   {application?.mvrCheckReason && <p>Reason: {application.mvrCheckReason}</p>}
                </div>
                <div className="pt-3 border-t space-y-2">
                  <div className="flex gap-2">
                    <select
                      className="flex-1 text-sm border rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      value={mvrStatus}
                      onChange={(e) => setMvrStatus(e.target.value as DriverCheckAdjudicationInputStatus)}
                    >
                      <option value="clear">Clear</option>
                      <option value="review">Needs Review</option>
                      <option value="pending">Pending</option>
                    </select>
                    <input
                      placeholder="Ref ID"
                      className="w-24 text-sm border rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      value={mvrRef}
                      onChange={(e) => setMvrRef(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      placeholder="Notes / Reason..."
                      className="flex-1 text-sm border rounded px-2 py-1.5 bg-[hsl(var(--background))]"
                      value={mvrReason}
                      onChange={(e) => setMvrReason(e.target.value)}
                    />
                    <button
                      onClick={handleAdjudicateMvr}
                      disabled={adjMvr.isPending}
                      className="px-3 py-1.5 text-sm font-semibold bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))] rounded"
                    >
                      Update
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <div className="border-t bg-[hsl(var(--card))] p-4 px-6 flex flex-wrap items-center gap-4 justify-between">
          <div className="flex-1 min-w-[200px]">
            <input
              className="w-full px-3 py-2 text-sm border rounded-lg bg-[hsl(var(--background))]"
              placeholder="Reason (required for reject/suspend)"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleDecision('rejected')}
              disabled={decide.isPending}
              className="px-4 py-2 text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => handleDecision('suspended')}
              disabled={decide.isPending}
              className="px-4 py-2 text-sm font-bold bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50"
            >
              Suspend
            </button>
            <button
              onClick={() => handleDecision('approved')}
              disabled={decide.isPending}
              className="px-4 py-2 text-sm font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve Driver
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AdminDrivers() {
  const { data = [], isLoading, isError, refetch } = useListAdminDriverReview();
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const filteredRows = useMemo(() => {
    return data.filter(row => {
      const matchSearch =
        !searchQuery.trim() ||
        row.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        row.phone?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus =
        statusFilter === 'all' ||
        row.approvalStatus === statusFilter ||
        row.onboardingStatus === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [data, searchQuery, statusFilter]);

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Drivers & Applications</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              Review onboarding drivers and manage active accounts.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-xl border bg-[hsl(var(--card))] px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            >
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
              <option value="rejected">Rejected</option>
            </select>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[hsl(var(--muted-foreground))]" />
              <input
                type="text"
                placeholder="Search drivers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2 pl-9 pr-4 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-[hsl(var(--card))] shadow-sm">
          <div className="divide-y">
            {isLoading ? (
              <div className="p-10 flex flex-col items-center justify-center text-[hsl(var(--muted-foreground))]">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-[hsl(var(--primary))]" />
                <p>Loading drivers...</p>
              </div>
            ) : isError ? (
              <div className="p-10 flex flex-col items-center justify-center">
                <AlertCircle className="w-10 h-10 text-red-500 mb-4" />
                <p className="font-semibold text-lg">Failed to load drivers</p>
                <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-[hsl(var(--primary))] text-white rounded-lg font-semibold flex items-center gap-2 shadow-sm hover:brightness-110">
                  <RefreshCcw className="w-4 h-4" /> Retry
                </button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center text-[hsl(var(--muted-foreground))]">
                <Car className="mb-4 size-12 opacity-20" />
                <p>No drivers found matching your criteria.</p>
              </div>
            ) : (
              filteredRows.map((row) => (
                <div key={row.id} className="p-5 hover:bg-[hsl(var(--muted))/30 transition-colors">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                    <div className="flex items-start gap-4">
                      {row.avatarUrl ? (
                        <img src={row.avatarUrl} alt={row.firstName} className="w-12 h-12 rounded-full object-cover shrink-0 border" />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center shrink-0 border">
                          <User className="w-6 h-6 text-[hsl(var(--muted-foreground))]" />
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-lg">{row.firstName} {row.lastName}</p>
                          <StatusBadge status={row.approvalStatus === 'approved' ? row.approvalStatus : row.onboardingStatus} />
                          {row.availabilityStatus === 'online' && (
                            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Online
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[hsl(var(--muted-foreground))]">
                          {row.email && <span>{row.email}</span>}
                          {row.phone && <span>{row.phone}</span>}
                          {row.vehicle && <span className="flex items-center gap-1"><Car className="w-3.5 h-3.5" /> {row.vehicle}</span>}
                        </div>

                        <div className="flex flex-wrap items-center gap-4 pt-1">
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Deliveries:</span>
                            <span className="font-semibold">{row.totalDeliveries}</span>
                          </div>
                          {row.earningsTotal !== undefined && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Earnings:</span>
                              <span className="font-semibold">${row.earningsTotal.toFixed(2)}</span>
                            </div>
                          )}
                          {row.activeDelivery && (
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Active:</span>
                              <span className="font-semibold text-[hsl(var(--primary))]">{row.activeDelivery.orderNumber}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center justify-end">
                      <button
                        onClick={() => setSelectedDriverId(row.id)}
                        className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] shadow-sm transition hover:brightness-110"
                      >
                        {row.approvalStatus === 'pending' || row.onboardingStatus === 'pending' || row.complianceReviewStatus === 'pending' ? 'Review Application' : 'Manage Driver'}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {selectedDriverId && (
        <DriverReviewModal id={selectedDriverId} onClose={() => setSelectedDriverId(null)} />
      )}
    </AdminLayout>
  );
}
