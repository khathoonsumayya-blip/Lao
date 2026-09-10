import { useLocation } from 'wouter';
import { useGetDriverOnboarding } from '@workspace/api-client-react';
import { User, Truck, Star, FileText, Settings, LogOut, Pencil } from 'lucide-react';
import { useDriverSession } from '@/lib/driver-session';

export default function Profile() {
  const [, setLocation] = useLocation();
  const { data: profile, isLoading: profileLoading, signOut } = useDriverSession();
  const { data: onboarding, isLoading: onboardingLoading } = useGetDriverOnboarding();

  if (profileLoading || onboardingLoading) return <div className="p-6" role="status">Loading profile…</div>;
  if (!profile) return <div className="p-6" role="alert">Your driver profile is unavailable.</div>;
  const logout = async () => {
    await signOut();
    setLocation('/welcome', { replace: true });
  };
  const driverPhoto = onboarding?.documents?.find((document) => document.documentType === 'driver_photo');
  const photoStatus = !driverPhoto ? 'Missing' : driverPhoto.verificationStatus;

  return (
    <div className="p-6 pb-24">
      <div className="mb-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-center gap-4 sm:gap-6">
        <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center text-muted-foreground shrink-0 border border-border">
          <User className="w-10 h-10" aria-label="Private driver photo placeholder" />
        </div>
        <div className="min-w-0">
          <h1 className="break-words font-display text-3xl font-bold uppercase leading-tight">{profile.firstName} {profile.lastName}</h1>
          <div className="font-mono text-xs uppercase tracking-widest text-primary mt-1">
            Status: {profile.approvalStatus}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Private photo: {photoStatus}</p>
        </div>
      </div>
        <button onClick={() => setLocation('/profile/edit')} className="driver-btn driver-btn-primary h-11 w-full shrink-0 px-3 text-xs sm:w-auto" data-testid="button-edit-profile">
          <Pencil className="size-4" />Edit profile
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="driver-card p-4 flex flex-col items-center justify-center text-center">
          <Star className="w-6 h-6 text-primary mb-2" />
          <div className="font-display text-2xl font-bold">{Number(profile.rating || 0).toFixed(1)}</div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Driver Rating</div>
        </div>
        <div className="driver-card p-4 flex flex-col items-center justify-center text-center">
          <Truck className="w-6 h-6 text-muted-foreground mb-2" />
          <div className="font-display text-2xl font-bold">{profile.completedDeliveries}</div>
          <div className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Completed Runs</div>
        </div>
      </div>

      <div className="space-y-6">
        {profile.complianceReviewStatus && profile.complianceReviewStatus !== 'none' && (
          <div
            className={`driver-card border p-4 ${
              profile.complianceReviewStatus === 'rejected'
                ? 'border-destructive/50 bg-destructive/10'
                : profile.complianceReviewStatus === 'pending'
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-emerald-500/50 bg-emerald-500/10'
            }`}
            data-testid="compliance-review-status"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-mono text-xs font-bold uppercase tracking-widest">Profile update</h2>
              <span className="rounded-full bg-background/70 px-3 py-1 text-xs font-bold uppercase">
                {profile.complianceReviewStatus === 'pending' ? 'Pending review' : profile.complianceReviewStatus}
              </span>
            </div>
            {profile.complianceReviewStatus === 'pending' && (
              <p className="mt-2 text-sm text-muted-foreground">
                Your approved vehicle stays active while the new details are reviewed.
              </p>
            )}
            {profile.complianceReviewStatus === 'rejected' && (
              <div className="mt-2">
                <p className="text-sm font-semibold">The requested changes were not approved.</p>
                {profile.complianceReviewReason && (
                  <p className="mt-1 break-words text-sm text-muted-foreground">
                    Reason: {profile.complianceReviewReason}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setLocation('/profile/edit')}
                  className="mt-3 min-h-11 text-sm font-bold text-primary underline underline-offset-4"
                >
                  Edit and resubmit
                </button>
              </div>
            )}
          </div>
        )}

        <div className="driver-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/20 flex items-center gap-3">
            <Truck className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-mono text-xs font-bold text-foreground uppercase tracking-widest">Assigned Vehicle</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-muted-foreground uppercase">Model</span>
               <span className="max-w-[65%] break-words text-right font-medium">{profile.vehicle || 'Not specified'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-muted-foreground uppercase">Plates</span>
              <span className="font-medium font-mono uppercase">{profile.licensePlate || 'Not specified'}</span>
            </div>
          </div>
        </div>

        <div className="driver-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/20 flex items-center gap-3">
            <FileText className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-mono text-xs font-bold text-foreground uppercase tracking-widest">Compliance Documents</h3>
          </div>
          <div className="p-4">
            {onboarding?.documents && onboarding.documents.length > 0 ? (
              <div className="space-y-4">
                {onboarding.documents.map(doc => {
                  const expired = Boolean(doc.expiryDate && new Date(doc.expiryDate).getTime() < Date.now());
                  const status = expired ? 'expired' : doc.verificationStatus;
                  return <div key={doc.id} className="flex items-start justify-between gap-3">
                    <div><span className="text-sm font-bold text-muted-foreground uppercase">{doc.documentType.replace('_', ' ')}</span>
                    {doc.expiryDate && <p className="text-xs text-muted-foreground">Expires {new Date(doc.expiryDate).toLocaleDateString()}</p>}
                    {doc.verificationStatus === 'rejected' && doc.rejectionReason && <p className="text-xs text-destructive">Reason: {doc.rejectionReason}</p>}</div>
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded ${
                      status === 'approved' ? 'bg-emerald-500/20 text-emerald-500' :
                      status === 'rejected' || status === 'expired' ? 'bg-destructive/20 text-destructive' :
                      'bg-secondary text-secondary-foreground'
                    }`}>
                      {status}
                    </span>
                  </div>;
                })}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground text-center py-2">No documents on file.</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button onClick={() => setLocation('/settings')} className="driver-btn driver-btn-secondary h-14 text-sm gap-2" data-testid="button-settings">
            <Settings className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={logout}
            className="driver-btn driver-btn-secondary h-14 text-sm gap-2 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4" />
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
