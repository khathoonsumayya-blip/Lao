import { useEffect, useState, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import {
  useListDriverOffers,
  useListDriverDeliveries,
  useUpdateDriverAvailability,
  useAcceptDriverDelivery,
  useDeclineDriverDelivery,
  useUpdateDriverAvailabilityLocation,
  useGetDriverSettings,
  getListDriverOffersQueryKey,
  getListDriverDeliveriesQueryKey,
  getGetDriverProfileQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { MapPin, Clock, Package, Navigation2, Zap, AlertTriangle, Settings } from 'lucide-react';
import { format, differenceInSeconds } from 'date-fns';
import { useDriverSession } from '@/lib/driver-session';
import { formatPickupSchedule } from '@/lib/pickup-schedule';

function CountdownTimer({ expiresAt, onExpire }: { expiresAt: string, onExpire?: () => void }) {
  const secondsUntilExpiry = () => Math.max(0, differenceInSeconds(new Date(expiresAt), new Date()));
  const [secondsLeft, setSecondsLeft] = useState(secondsUntilExpiry);
  const onExpireRef = useRef(onExpire);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    setSecondsLeft(secondsUntilExpiry());
    const timer = setInterval(() => {
      setSecondsLeft((current) => {
        const remaining = Math.max(0, current - 1);
        if (remaining === 0 && current !== 0) onExpireRef.current?.();
        return remaining;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (secondsLeft === 0) {
    return <span className="text-destructive">Expired</span>;
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const isUrgent = secondsLeft < 30;

  return (
    <span className={`font-mono ${isUrgent ? 'text-destructive animate-pulse' : 'text-primary'}`}>
      {mins}:{secs.toString().padStart(2, '0')}
    </span>
  );
}

export default function Home() {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'route' | 'offers'>('route');

  useEffect(() => {
    setActiveTab(location === '/orders' || location === '/available-deliveries' ? 'offers' : 'route');
  }, [location]);

  const { data: profile } = useDriverSession();
  const canReceiveOffers = profile?.approvalStatus === 'approved' && profile?.availabilityStatus === 'online';

  const { data: availableOffers = [] } = useListDriverOffers({
    query: {
      queryKey: getListDriverOffersQueryKey(),
      enabled: canReceiveOffers,
      refetchInterval: canReceiveOffers ? 15_000 : false,
    },
  });
  const { data: deliveries = [] } = useListDriverDeliveries({ query: { queryKey: getListDriverDeliveriesQueryKey(), refetchInterval: 15_000 } });
  const { data: settings } = useGetDriverSettings();

  const updateAvailability = useUpdateDriverAvailability();
  const acceptDelivery = useAcceptDriverDelivery();
  const declineDelivery = useDeclineDriverDelivery();
  const updateLocation = useUpdateDriverAvailabilityLocation();

  const [decliningOfferId, setDecliningOfferId] = useState<string | null>(null);

  // Audio & Vibration for new offers
  const knownOfferIds = useRef<Set<string>>(new Set());
  const hasHydrated = useRef(false);

  useEffect(() => {
    if (!availableOffers) return;

    // Only alert on NEW offers that arrive after initial hydration
    if (hasHydrated.current && settings) {
      const newOffer = availableOffers.find(o => !knownOfferIds.current.has(o.id));
      if (newOffer) {
        if (settings.notificationSound) {
          try {
            const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (AudioContextClass) {
              const context = new AudioContextClass();
              const oscillator = context.createOscillator();
              const gain = context.createGain();
              oscillator.frequency.value = 880;
              gain.gain.setValueAtTime(0.12, context.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.35);
              oscillator.connect(gain);
              gain.connect(context.destination);
              oscillator.start();
              oscillator.stop(context.currentTime + 0.35);
              oscillator.addEventListener('ended', () => void context.close());
            }
          } catch {
            // Browsers may block audio until the Driver has interacted with the page.
          }
        }
        if (settings.vibration && typeof navigator !== 'undefined' && navigator.vibrate) {
          try {
            navigator.vibrate([200, 100, 200]);
          } catch { /* Device vibration may be unavailable or disabled. */ }
        }
      }
    }

    knownOfferIds.current = new Set(availableOffers.map(o => o.id));
    hasHydrated.current = true;
  }, [availableOffers, settings]);

  // Location Heartbeat
  const [locationError, setLocationError] = useState(false);
  const locationUpdateInProgress = useRef(false);

  useEffect(() => {
    if (!canReceiveOffers) {
      setLocationError(false);
      return;
    }

    let watchId: number;
    let intervalId: ReturnType<typeof setInterval>;

    const sendLocation = (position: GeolocationPosition) => {
      if (locationUpdateInProgress.current) return;
      locationUpdateInProgress.current = true;

      updateLocation.mutate(
        {
          data: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            capturedAt: new Date(position.timestamp).toISOString()
          }
        },
        {
          onSettled: () => {
            locationUpdateInProgress.current = false;
          }
        }
      );
    };

    const fetchPosition = () => {
      if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setLocationError(false);
            sendLocation(position);
          },
          (error) => {
            console.warn('Geolocation error:', error);
            setLocationError(true);
          },
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
        );
      }
    };

    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      // Fire immediately via watchPosition
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          setLocationError(false);
          sendLocation(position);
        },
        (error) => {
          console.warn('Geolocation error:', error);
          setLocationError(true);
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
      );

      // Force a regular heartbeat interval just in case watchPosition doesn't fire when stationary
      intervalId = setInterval(fetchPosition, 30_000);
    } else {
      setLocationError(true);
    }

    return () => {
      if (watchId !== undefined && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [canReceiveOffers, updateLocation]);


  if (!profile) return null;

  if (profile.approvalStatus !== 'approved') {
    return (
      <div className="p-6 pt-16 text-center">
        <AlertTriangle className="w-16 h-16 text-destructive mx-auto mb-6" />
        <h1 className="font-display text-2xl font-bold uppercase mb-4 text-destructive">Access Denied</h1>
        <p className="text-muted-foreground mb-8">
          You must be an approved driver to view offers and go online.
        </p>
        <button
          onClick={() => setLocation('/onboarding')}
          className="driver-btn driver-btn-secondary w-full"
          data-testid="button-check-status"
        >
          Check Status
        </button>
      </div>
    );
  }

  const isOnline = profile.availabilityStatus === 'online';
  const offers = isOnline ? availableOffers : [];
  const activeDeliveries = deliveries.filter(d => !['delivered', 'cancelled', 'failed', 'refunded'].includes(d.status));
  const hasActiveDelivery = activeDeliveries.length > 0;

  const toggleAvailability = () => {
    const newStatus = isOnline ? 'offline' : 'online';
    updateAvailability.mutate({ data: { availabilityStatus: newStatus } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDriverProfileQueryKey() });
        if (newStatus === 'offline') {
          queryClient.setQueryData(getListDriverOffersQueryKey(), []);
        }
      }
    });
  };

  const handleAcceptOffer = (offerId: string) => {
    acceptDelivery.mutate({ id: offerId }, {
      onSuccess: (delivery) => {
        queryClient.invalidateQueries({ queryKey: getListDriverOffersQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListDriverDeliveriesQueryKey() });
        setLocation(`/deliveries/${delivery.id}`);
      }
    });
  };

  const handleDeclineOffer = (offerId: string) => {
    declineDelivery.mutate({ id: offerId }, {
      onSuccess: () => {
        setDecliningOfferId(null);
        queryClient.invalidateQueries({ queryKey: getListDriverOffersQueryKey() });
      }
    });
  };

  return (
    <div className="pb-8">
      {/* Header & Status */}
      <div className="bg-card border-b border-border p-6 pt-10 rounded-b-[2rem] shadow-lg mb-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
          <Zap className="w-32 h-32" />
        </div>

        <div className="flex items-center justify-between mb-8 relative z-10">
          <div>
            <h1 className="font-display text-2xl font-bold uppercase tracking-tight">Ready to deliver, {profile.firstName}</h1>
            <p className="text-muted-foreground font-mono text-xs uppercase mt-1">Vehicle: {profile.vehicle || 'Unassigned'}</p>
          </div>
          <div className="flex flex-col items-end">
            <button
              onClick={toggleAvailability}
              disabled={updateAvailability.isPending}
              aria-pressed={isOnline}
              aria-label={isOnline ? 'Set availability to offline' : 'Set availability to online'}
              className={`h-12 px-6 rounded-xl font-bold font-mono text-xs uppercase tracking-widest transition-all ${
                isOnline
                  ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                  : 'bg-secondary text-secondary-foreground border border-border'
              }`}
              data-testid="button-toggle-availability"
            >
              {isOnline ? 'Online' : 'Offline'}
            </button>
          </div>
        </div>

        <div className="flex bg-background/50 rounded-xl p-1 relative z-10">
          <button
            onClick={() => setActiveTab('route')}
            className={`flex-1 py-3 text-sm font-bold uppercase rounded-lg transition-colors ${
              activeTab === 'route' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
            data-testid="tab-route"
          >
              Current delivery {activeDeliveries.length > 0 && `(${activeDeliveries.length})`}
          </button>
          <button
            onClick={() => setActiveTab('offers')}
            className={`flex-1 py-3 text-sm font-bold uppercase rounded-lg transition-colors flex items-center justify-center gap-2 ${
              activeTab === 'offers' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
            }`}
            data-testid="tab-offers"
          >
              New requests
            {offers.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
                {offers.length}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="px-4">
        {isOnline && locationError && (
          <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-amber-500 text-sm">Location Access Required</h3>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  We cannot access your live location. Location tracking is required to receive new delivery offers.
                </p>
                <Link href="/settings" className="inline-flex items-center gap-2 text-xs font-bold bg-amber-500/20 text-amber-600 px-3 py-1.5 rounded-lg hover:bg-amber-500/30 transition-colors">
                  <Settings className="size-3" /> Check Settings
                </Link>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'route' && (
          <div className="space-y-4">
            {!hasActiveDelivery ? (
              <div className="text-center py-12 px-4 border-2 border-dashed border-border rounded-2xl">
                <Navigation2 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-display text-xl uppercase font-bold text-muted-foreground mb-2">No delivery in progress</h3>
                <p className="text-sm text-muted-foreground/70">
                  Go online, then check New requests when you are ready for your next delivery.
                </p>
              </div>
            ) : (
              activeDeliveries.map((delivery) => (
                <Link key={delivery.id} href={`/deliveries/${delivery.id}`}>
                  <div className="driver-ticket cursor-pointer hover:border-primary/50 transition-colors" data-testid={`card-active-delivery-${delivery.id}`}>
                    <div className="p-5">
                      <div className="flex justify-between items-start mb-4">
                        <div className="bg-primary/20 text-primary px-3 py-1 rounded-md font-mono text-[10px] font-bold uppercase tracking-widest">
                          {delivery.orderNumber}
                        </div>
                        <div className="font-mono text-xs font-bold text-foreground bg-secondary px-2 py-1 rounded">
                          {delivery.status.replace(/_/g, ' ')}
                        </div>
                      </div>

                      <div className="space-y-4 mb-4">
                         <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary" data-testid={`text-pickup-schedule-${delivery.id}`}>
                           <Clock className="w-4 h-4 shrink-0" /><span>Pickup window: {formatPickupSchedule((delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupStartAt, (delivery as typeof delivery & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupEndAt)}</span>
                         </div>
                        <div className="flex gap-4 items-start">
                          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                            <Package className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-muted-foreground uppercase mb-1">Pickup</div>
                            <div className="font-medium text-sm">{delivery.pickupAddress}</div>
                          </div>
                        </div>
                        <div className="flex gap-4 items-start">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <MapPin className="w-4 h-4 text-primary" />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-primary uppercase mb-1">Dropoff</div>
                            <div className="font-medium text-sm">{delivery.dropoffAddress}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="driver-ticket-divider p-4 bg-secondary/30 flex justify-between items-center">
                      <div className="font-mono text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                          ETA: {delivery.eta && !Number.isNaN(new Date(delivery.eta).getTime()) ? format(new Date(delivery.eta), 'HH:mm') : 'Not available'}
                      </div>
                      <div className="font-bold text-primary">Resume Route</div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        )}

        {activeTab === 'offers' && (
          <div className="space-y-4">
            {!isOnline ? (
              <div className="text-center py-12 px-4 driver-card bg-secondary/20">
                <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                <h3 className="font-display text-xl uppercase font-bold text-muted-foreground mb-2">You’re offline</h3>
                <p className="text-sm text-muted-foreground/70 mb-6">
                  You must be online to receive new delivery dispatch offers.
                </p>
                <button
                  onClick={toggleAvailability}
                  className="driver-btn driver-btn-primary"
                >
                  Go Online
                </button>
              </div>
            ) : offers.length === 0 ? (
              <div className="text-center py-12 px-4 border-2 border-dashed border-border rounded-2xl">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                <h3 className="font-display text-xl uppercase font-bold text-muted-foreground mb-2">Looking for requests</h3>
                <p className="text-sm text-muted-foreground/70">
                  Keep this screen open. New delivery requests will appear here automatically.
                </p>
              </div>
            ) : (
              offers.map((offer) => (
                <div key={offer.id} className="driver-card p-5" data-testid={`card-offer-${offer.id}`}>
                  <div className="flex justify-between items-start mb-6 border-b border-border pb-4">
                    <div>
                      <div className="font-mono text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
                        <span>Offer</span>
                        <span className="w-1 h-1 rounded-full bg-border" />
                        <CountdownTimer expiresAt={offer.expiresAt} onExpire={() => queryClient.invalidateQueries({ queryKey: getListDriverOffersQueryKey() })} />
                      </div>
                       <div className="font-display text-3xl font-bold text-emerald-500">${Number(offer.earnings || 0).toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] text-muted-foreground font-bold uppercase tracking-widest mb-1">
                        Est. Time {offer.distanceSource === 'fallback' && '*'}
                      </div>
                      <div className="font-bold text-lg">{offer.expectedMinutes + (offer.estimatedPickupMinutes || 0)} MIN</div>
                    </div>
                  </div>

                  <div className="space-y-4 mb-6">
                     <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 text-xs font-bold text-primary" data-testid={`text-offer-pickup-schedule-${offer.id}`}>
                       <Clock className="w-4 h-4 shrink-0" /><span>Pickup window: {formatPickupSchedule((offer as typeof offer & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupStartAt, (offer as typeof offer & { scheduledPickupStartAt: string | null; scheduledPickupEndAt: string | null }).scheduledPickupEndAt)}</span>
                     </div>
                    <div className="flex items-start gap-4">
                      <div className="w-2 h-2 rounded-full bg-secondary mt-1.5" />
                      <div>
                        <div className="text-xs text-muted-foreground font-bold uppercase flex justify-between items-center w-full">
                          <span>Pickup Area</span>
                          <span className="text-foreground">{offer.estimatedPickupMinutes ? `${offer.estimatedPickupMinutes} min` : ''}</span>
                        </div>
                        <div className="font-medium text-sm">{offer.pickupArea}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{offer.pickupDistanceMiles != null ? `${offer.pickupDistanceMiles.toFixed(1)} mi away` : 'Distance unknown'}</div>
                      </div>
                    </div>
                    <div className="w-0.5 h-6 bg-border ml-1" />
                    <div className="flex items-start gap-4">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5" />
                      <div>
                        <div className="text-xs text-primary font-bold uppercase flex justify-between items-center w-full">
                          <span>Dropoff Area</span>
                          <span className="text-foreground">{offer.expectedMinutes} min</span>
                        </div>
                        <div className="font-medium text-sm">{offer.dropoffArea}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{offer.deliveryDistanceMiles != null ? `${offer.deliveryDistanceMiles.toFixed(1)} mi route` : 'Route length unknown'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2 mb-6">
                    <div className="bg-secondary/50 px-2 py-1 rounded text-[10px] font-bold uppercase font-mono border border-border">{offer.category}</div>
                    <div className="bg-secondary/50 px-2 py-1 rounded text-[10px] font-bold uppercase font-mono border border-border">{offer.size}</div>
                    <div className="bg-secondary/50 px-2 py-1 rounded text-[10px] font-bold uppercase font-mono border border-border">{offer.care}</div>
                  </div>

                  {offer.distanceSource === 'fallback' && (
                    <p className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest text-center mb-4 opacity-70">
                      * Times and distances are estimates
                    </p>
                  )}

                  {declineDelivery.isError && decliningOfferId === offer.id && (
                    <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg border border-destructive/20 font-medium text-center">
                      Failed to decline delivery. Please try again.
                    </div>
                  )}

                  {decliningOfferId === offer.id ? (
                    <div className="space-y-3">
                      <p className="text-sm font-bold text-center mb-2">Are you sure you want to decline this offer?</p>
                      <div className="flex gap-3">
                        <button
                          onClick={() => setDecliningOfferId(null)}
                          disabled={declineDelivery.isPending || acceptDelivery.isPending}
                          className="driver-btn driver-btn-secondary flex-1 !h-14 !text-sm"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDeclineOffer(offer.id)}
                          disabled={declineDelivery.isPending || acceptDelivery.isPending}
                          className="driver-btn driver-btn-destructive flex-1 !h-14 !text-sm"
                          data-testid={`button-confirm-decline-${offer.id}`}
                        >
                          Decline
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <button
                        onClick={() => handleAcceptOffer(offer.id)}
                        disabled={acceptDelivery.isPending || declineDelivery.isPending}
                        className="driver-btn driver-btn-primary w-full shadow-lg shadow-primary/20"
                        data-testid={`button-accept-offer-${offer.id}`}
                      >
                        Accept Route
                      </button>
                      <button
                        onClick={() => setDecliningOfferId(offer.id)}
                        disabled={acceptDelivery.isPending || declineDelivery.isPending}
                        className="driver-btn driver-btn-secondary w-full !h-14 bg-card border border-border text-foreground hover:bg-secondary"
                        data-testid={`button-decline-offer-${offer.id}`}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
