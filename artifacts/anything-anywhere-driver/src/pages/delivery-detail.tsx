import { useEffect, useRef, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import {
  useGetDelivery,
  useGetDeliveryRoute,
  useUpdateDriverDeliveryStatus,
  useUpdateDriverLocation,
  useVerifyDriverRecipient,
  useGetDriverSettings,
  getGetDeliveryQueryKey,
  getGetDeliveryRouteQueryKey,
  getListDriverDeliveriesQueryKey,
  getListDriverOffersQueryKey,
  DeliveryStatusUpdateStatus
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Package, Phone, CheckCircle2, AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { DeliveryMap } from '@/components/delivery-map';
import { formatPickupSchedule } from '@/lib/pickup-schedule';

export default function DeliveryDetail() {
  const [, legacyParams] = useRoute('/delivery/:id');
  const [, deliveryParams] = useRoute('/deliveries/:deliveryId');
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const id = legacyParams?.id || deliveryParams?.deliveryId || '';

  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const { data: delivery, isLoading, isError, error, refetch } = useGetDelivery(id, { query: { queryKey: getGetDeliveryQueryKey(id), enabled: validId, retry: false } });
  const updateStatus = useUpdateDriverDeliveryStatus();
  const updateLocation = useUpdateDriverLocation();
  const verifyRecipient = useVerifyDriverRecipient();
  const route = useGetDeliveryRoute(id, { query: { queryKey: getGetDeliveryRouteQueryKey(id), enabled: validId, refetchInterval: 15_000, retry: false } });
  const { data: settings } = useGetDriverSettings();

  const [otp, setOtp] = useState('');
  const [verificationError, setVerificationError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [actionError, setActionError] = useState('');
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [locationState, setLocationState] = useState<'ready' | 'requesting' | 'sharing' | 'denied' | 'unavailable'>('ready');
  const lastSent = useRef<{ at: number; latitude: number; longitude: number } | null>(null);
  const locationRequest = useRef(0);
  const locationRequestTimer = useRef<number | null>(null);

  useEffect(() => {
    const isTerminal = !delivery || ['delivered', 'cancelled', 'failed', 'refunded'].includes(delivery.status);
    if (!trackingEnabled || isTerminal || !validId || !navigator.geolocation) return;
    const report = (position: GeolocationPosition) => {
      const now = Date.now();
      const previous = lastSent.current;
      const movementMeters = previous
        ? Math.hypot((position.coords.latitude - previous.latitude) * 111_139, (position.coords.longitude - previous.longitude) * 91_000)
        : Infinity;
      if (previous && now - previous.at < 20_000 && movementMeters < 20) return;
      lastSent.current = { at: now, latitude: position.coords.latitude, longitude: position.coords.longitude };
      updateLocation.mutate({
        id,
        data: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.round(position.coords.accuracy),
          capturedAt: new Date(position.timestamp).toISOString(),
        },
      }, {
        onSuccess: () => { setLocationError(''); setLocationState('sharing'); },
        onError: () => setLocationError(navigator.onLine ? 'Live location will retry with your next GPS update.' : 'You are offline. Your next GPS update will send when you reconnect.'),
      });
    };
    const watchId = navigator.geolocation.watchPosition(report, (error) => {
      setTrackingEnabled(false);
      setLocationState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
      setLocationError(error.code === error.PERMISSION_DENIED ? 'Location permission is required to share this active route.' : 'Location is temporarily unavailable. Try again when you have a clear signal.');
    }, {
      enableHighAccuracy: true,
      maximumAge: 15_000,
      timeout: 20_000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [delivery?.status, id, validId, trackingEnabled, updateLocation]);

  useEffect(() => () => {
    if (locationRequestTimer.current !== null) window.clearTimeout(locationRequestTimer.current);
  }, []);

  const enableTracking = () => {
    if (!navigator.geolocation) {
      setLocationState('unavailable');
      setLocationError('This browser does not support live location sharing.');
      return;
    }
    const requestId = ++locationRequest.current;
    setLocationState('requesting');
    setLocationError('');
    if (locationRequestTimer.current !== null) window.clearTimeout(locationRequestTimer.current);
    locationRequestTimer.current = window.setTimeout(() => {
      if (locationRequest.current !== requestId) return;
      locationRequest.current += 1;
      setLocationState('unavailable');
      setLocationError('Location permission did not respond. Check your browser settings, then try again.');
    }, 12_000);
    navigator.geolocation.getCurrentPosition(
      () => {
        if (locationRequest.current !== requestId) return;
        if (locationRequestTimer.current !== null) window.clearTimeout(locationRequestTimer.current);
        lastSent.current = null; setTrackingEnabled(true); setLocationState('sharing');
      },
      (error) => {
        if (locationRequest.current !== requestId) return;
        if (locationRequestTimer.current !== null) window.clearTimeout(locationRequestTimer.current);
        setTrackingEnabled(false);
        setLocationState(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable');
        setLocationError(error.code === error.PERMISSION_DENIED ? 'Location permission is required to share this active route.' : 'We could not get your location. Check your signal and try again.');
      },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
  };

  if (!validId) return <div className="p-6 text-center mt-20" role="alert">This delivery link is invalid. <button className="underline" onClick={() => setLocation('/deliveries')}>Return to Active Delivery</button></div>;
  if (isLoading) return <div className="p-6 pt-20 text-center" role="status">Loading delivery…</div>;
  if (isError) return <div className="p-6 text-center mt-20" role="alert">We could not load this delivery.<p className="mt-2 text-sm">{(error as Error).message}</p><button className="driver-btn driver-btn-primary mt-5" onClick={() => refetch()}>Try again</button></div>;
  if (!delivery) return <div className="p-6 text-center mt-20" role="alert">Route data was not found.</div>;

  const handleStatusUpdate = (status: DeliveryStatusUpdateStatus) => {
    setActionError('');
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDeliveryQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListDriverDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDriverOffersQueryKey() });
      },
      onError: (err) => setActionError((err as Error).message || 'Status update failed. Please try again.')
    });
  };

  const handleVerifyOTP = (e: React.FormEvent) => {
    e.preventDefault();
    setVerificationError('');
    verifyRecipient.mutate({ id, data: { otp } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDeliveryQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListDriverDeliveriesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDriverOffersQueryKey() });
        setOtp('');
      },
      onError: (err) => {
        setVerificationError((err as Error).message || 'We could not verify that code.');
      }
    });
  };

  // State derivations
  const isAssigned = delivery.status === 'driver_assigned';
  const isEnRoutePickup = delivery.status === 'driver_en_route_pickup';
  const isAtPickup = delivery.status === 'driver_arrived_pickup';
  const isPickupVerified = delivery.status === 'pickup_verified';
  const isPickedUp = delivery.status === 'picked_up';
  const isInTransit = delivery.status === 'in_transit';
  const isAtDropoff = delivery.status === 'driver_arrived_delivery';
  const isVerifyPending = delivery.status === 'delivery_verification_pending';
  const isDelivered = delivery.status === 'delivered';

  const isRoutingToPickup = isAssigned || isEnRoutePickup;
  const isRoutingToDropoff = isPickedUp || isInTransit;
  const scheduledDelivery = delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null };

  const getNavigationUrl = () => {
    const lat = isRoutingToPickup ? delivery.pickupLatitude : delivery.dropoffLatitude;
    const lng = isRoutingToPickup ? delivery.pickupLongitude : delivery.dropoffLongitude;
    const address = isRoutingToPickup ? delivery.pickupAddress : delivery.dropoffAddress;

    const query = lat != null && lng != null ? `${lat},${lng}` : encodeURIComponent(address);
    const navApp = settings?.navigationApp || 'system';

    if (navApp === 'google_maps') {
      return `https://www.google.com/maps/dir/?api=1&destination=${query}`;
    } else if (navApp === 'apple_maps') {
      return `http://maps.apple.com/?daddr=${query}`;
    } else if (navApp === 'waze') {
      if (lat != null && lng != null) {
        return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
      }
      return `https://waze.com/ul?q=${query}&navigate=yes`;
    }

    // System fallback
    return `https://www.google.com/maps/dir/?api=1&destination=${query}`;
  };

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-40 shadow-md flex items-center gap-4">
        <button
          onClick={() => setLocation('/deliveries')}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-secondary text-secondary-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <div className="font-mono text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
            {delivery.orderNumber}
          </div>
          <div className="font-display font-bold text-lg uppercase leading-tight">
            Active Route
          </div>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Status Banner */}
        <div className="driver-card p-4 flex items-center gap-4 bg-primary/10 border-primary/30">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground shrink-0 shadow-lg shadow-primary/20">
            {isDelivered ? <CheckCircle2 className="w-6 h-6" /> : <MapPin className="w-6 h-6" />}
          </div>
          <div>
            <div className="text-xs font-bold text-primary uppercase font-mono tracking-widest mb-1">Delivery status</div>
            <div className="font-bold text-lg leading-tight uppercase">
              {delivery.status.replace(/_/g, ' ')}
            </div>
          </div>
        </div>
        <section className="driver-card p-4" data-testid="text-detail-pickup-schedule">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">Scheduled pickup</p>
          <p className="mt-1 text-base font-bold text-primary">{formatPickupSchedule(scheduledDelivery.scheduledPickupStartAt, scheduledDelivery.scheduledPickupEndAt)}</p>
        </section>
        {locationError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">
            {locationError}
          </div>
        )}
        {actionError && <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" role="alert">{actionError}</div>}
        {!['delivered', 'cancelled', 'failed', 'refunded'].includes(delivery.status) && (
          <section className="driver-card p-4" data-testid="driver-live-location">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">Customer live location</p>
                <p className="mt-1 text-sm text-muted-foreground">{locationState === 'sharing' ? 'Sharing your real GPS while this route is open.' : 'Choose when to share your real GPS with this delivery’s customer.'}</p>
              </div>
              <span className={`mt-1 size-2.5 shrink-0 rounded-full ${locationState === 'sharing' ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'}`} aria-label={locationState === 'sharing' ? 'Live location sharing active' : 'Live location sharing off'} />
            </div>
            {locationState === 'sharing'
              ? <button onClick={() => { locationRequest.current += 1; setTrackingEnabled(false); setLocationState('ready'); setLocationError(''); }} className="driver-btn driver-btn-secondary mt-4 w-full" data-testid="button-disable-live-location">Stop sharing live location</button>
              : <button onClick={enableTracking} disabled={locationState === 'requesting'} className="driver-btn driver-btn-primary mt-4 w-full" data-testid="button-enable-live-location">{locationState === 'requesting' ? 'Requesting location…' : locationState === 'denied' ? 'Try location permission again' : 'Enable live location'}</button>}
          </section>
        )}

        {/* Action Panel - Dynamic based on status */}
        <div className="driver-card p-5 border-2 border-primary/50 shadow-xl shadow-primary/5 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 opacity-5 pointer-events-none">
            <Package className="w-32 h-32" />
          </div>

          <h3 className="font-mono text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">Next step</h3>

          {isAssigned && (
            <button
              onClick={() => handleStatusUpdate('driver_en_route_pickup')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-start-pickup-route"
            >
              Start Pickup Route
            </button>
          )}

          {isEnRoutePickup && (
            <button
              onClick={() => handleStatusUpdate('driver_arrived_pickup')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-arrived-pickup"
            >
              I'm at Pickup
            </button>
          )}

          {isAtPickup && (
            <button
              onClick={() => handleStatusUpdate('pickup_verified')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-verify-pickup"
            >
              Verify Package
            </button>
          )}

          {isPickupVerified && (
            <button
              onClick={() => handleStatusUpdate('picked_up')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-confirm-picked-up"
            >
              Package Picked Up
            </button>
          )}

          {isPickedUp && (
            <button
              onClick={() => handleStatusUpdate('in_transit')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-start-transit"
            >
              Start Transit
            </button>
          )}

          {isInTransit && (
            <button
              onClick={() => handleStatusUpdate('driver_arrived_delivery')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-arrived-dropoff"
            >
              I'm at Dropoff
            </button>
          )}

          {isAtDropoff && (
            <button
              onClick={() => handleStatusUpdate('delivery_verification_pending')}
              disabled={updateStatus.isPending}
              className="driver-btn driver-btn-primary w-full text-xl h-20"
              data-testid="button-request-verification"
            >
              Request Recipient Code
            </button>
          )}

          {isVerifyPending && (
            <form onSubmit={handleVerifyOTP} className="space-y-4">
              <div className="bg-background rounded-xl p-4 border border-border text-center">
                <ShieldCheck className="w-8 h-8 text-primary mx-auto mb-2" />
                <p className="text-sm font-medium mb-4">Ask the recipient for their 4-6 digit secure delivery code.</p>
                <input
                  type="text"
                  placeholder="ENTER CODE"
                  className="w-full h-16 text-center text-2xl tracking-[0.5em] font-mono font-bold"
                  value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  data-testid="input-otp"
                />
                {verificationError && (
                  <div className="text-destructive text-sm font-bold mt-2">{verificationError}</div>
                )}
              </div>
              <button
                type="submit"
                disabled={verifyRecipient.isPending || otp.length < 4}
                className="driver-btn driver-btn-primary w-full"
                data-testid="button-submit-otp"
              >
                Verify & Complete
              </button>
            </form>
          )}

          {isDelivered && (
            <div className="text-center py-6 text-emerald-500">
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4" />
              <div className="font-display text-2xl font-bold uppercase">Delivered successfully</div>
            </div>
          )}
        </div>

        <section className="driver-card overflow-hidden">
          <div className="border-b border-border bg-secondary/20 p-4 flex items-center justify-between">
            <p className="font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">Navigation preview</p>
            {(isRoutingToPickup || isRoutingToDropoff) && (
              <a
                href={getNavigationUrl()}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline underline-offset-4"
              >
                Open Nav <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          <div className="p-3">
            <DeliveryMap
              pickup={{ label: delivery.pickupAddress, latitude: delivery.pickupLatitude, longitude: delivery.pickupLongitude, kind: 'pickup' }}
              dropoff={{ label: delivery.dropoffAddress, latitude: delivery.dropoffLatitude, longitude: delivery.dropoffLongitude, kind: 'dropoff' }}
              driverLocation={route.data?.driverLocation ? { label: 'Your shared location', latitude: route.data.driverLocation.latitude, longitude: route.data.driverLocation.longitude, kind: 'driver' } : null}
              encodedPolyline={route.data?.encodedPolyline}
              demoMode={route.data?.status !== 'available'}
            />
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{route.data?.status === 'available' ? `${route.data.distanceMeters ? `${(route.data.distanceMeters / 1609.34).toFixed(1)} mi · ` : ''}${route.data.durationSeconds ? `${Math.ceil(route.data.durationSeconds / 60)} min` : 'Route ready'}` : route.data?.message || 'Waiting for mapped route details. Your browser location sharing stays optional.'}</p>
          </div>
        </section>

        {/* Details List */}
        <div className="driver-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/20">
            <h3 className="font-mono text-xs font-bold text-foreground uppercase tracking-widest">Manifest Details</h3>
          </div>

          <div className="p-4 space-y-6">
            <div>
              <div className="text-xs font-bold text-muted-foreground uppercase mb-2">Pickup Location</div>
              <div className="font-medium text-lg leading-snug">{delivery.pickupAddress}</div>
            </div>

            <div className="w-full h-px bg-border" />

            <div>
              <div className="text-xs font-bold text-primary uppercase mb-2">Dropoff Location</div>
              <div className="font-medium text-lg leading-snug">{delivery.dropoffAddress}</div>
              {delivery.recipientName && (
                <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                  <div className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center">
                    <Phone className="w-3 h-3" />
                  </div>
                  Recipient: <strong>{delivery.recipientName}</strong>
                </div>
              )}
            </div>

            <div className="w-full h-px bg-border" />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-mono font-bold text-muted-foreground uppercase mb-1">Category</div>
                <div className="font-bold">{delivery.category}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono font-bold text-muted-foreground uppercase mb-1">Care Level</div>
                <div className="font-bold text-primary">{delivery.care}</div>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => setLocation('/safety')}
          className="w-full py-4 text-sm font-bold text-muted-foreground flex items-center justify-center gap-2 uppercase tracking-widest hover:text-destructive transition-colors"
          data-testid="button-report-issue"
        >
          <AlertTriangle className="w-4 h-4" />
          Report a delivery issue
        </button>
      </div>
    </div>
  );
}
