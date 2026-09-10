import { useEffect, useRef, useState } from 'react';
import {
  deliveryMapConfirmationMessage,
  deliveryMapPointLabel,
  usableDeliveryMapPoint,
  type DeliveryMapPoint,
} from './delivery-map-model';

export type MapPoint = DeliveryMapPoint;

type DeliveryMapProps = {
  pickup?: MapPoint;
  dropoff?: MapPoint;
  driverLocation?: MapPoint | null;
  markers?: MapPoint[];
  encodedPolyline?: string | null;
  demoMode?: boolean;
  className?: string;
  title?: string;
  followDriver?: boolean;
};

function decodePolyline(encoded: string) {
  const path: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    path.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }
  return path;
}

function loadGoogleMaps(key: string): Promise<void> {
  const googleWindow = window as Window & { google?: { maps?: unknown }; __aaMapsPromise?: Promise<void> };
  if (googleWindow.google?.maps) return Promise.resolve();
  if (googleWindow.__aaMapsPromise) return googleWindow.__aaMapsPromise;
  googleWindow.__aaMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps could not load.'));
    document.head.appendChild(script);
  });
  return googleWindow.__aaMapsPromise;
}

export function DeliveryMap({
  pickup,
  dropoff,
  driverLocation,
  markers,
  encodedPolyline,
  demoMode = false,
  className = '',
  title = 'Delivery map',
  followDriver = false,
}: DeliveryMapProps) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const markerOverlays = useRef(new Map<string, any>());
  const routeOverlay = useRef<any>(null);
  const animationFrame = useRef<number | null>(null);
  const fittedInitialBounds = useRef(false);
  const userAdjustedViewport = useRef(false);
  const webKey = import.meta.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY as string | undefined;
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const points = [
    ...(markers ?? []),
    ...(markers ? [] : [pickup, dropoff, driverLocation].filter(Boolean) as MapPoint[]),
  ].map(usableDeliveryMapPoint).filter((point): point is NonNullable<typeof point> => Boolean(point));
  const showDemo = demoMode || !webKey || mapUnavailable;

  useEffect(() => {
    if (showDemo || !mapNode.current || !webKey) return;
    let active = true;
    void loadGoogleMaps(webKey)
      .then(() => {
        if (!active || !mapNode.current) return;
        const maps = (window as any).google.maps;
        if (mapInstance.current) return;
        const map = new maps.Map(mapNode.current, {
          center: { lat: points[0]?.latitude ?? 0, lng: points[0]?.longitude ?? 0 },
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'cooperative',
        });
        mapInstance.current = map;
        setMapReady(true);
        map.addListener('dragstart', () => { userAdjustedViewport.current = true; });
        map.addListener('zoom_changed', () => {
          if (fittedInitialBounds.current) userAdjustedViewport.current = true;
        });
      })
      .catch(() => setMapUnavailable(true));
    return () => { active = false; };
  }, [webKey, showDemo]);

  useEffect(() => {
    const map = mapInstance.current;
    if (showDemo || !map || !points.length) return;
    const maps = (window as any).google.maps;
    const markerKey = (point: NonNullable<typeof points>[number]) => point.kind === 'driver' ? 'driver' : `${point.kind ?? 'marker'}:${point.label}`;
    const desiredKeys = new Set(points.map(markerKey));
    markerOverlays.current.forEach((marker, key) => {
      if (!desiredKeys.has(key)) {
        marker.setMap(null);
        markerOverlays.current.delete(key);
      }
    });
    const bounds = new maps.LatLngBounds();
    points.forEach((point) => {
      const position = { lat: point.latitude, lng: point.longitude };
      const key = markerKey(point);
      const existing = markerOverlays.current.get(key);
      bounds.extend(position);
      if (!existing) {
        const marker = new maps.Marker({
          map,
          position,
          title: point.label,
          label: point.kind === 'driver' ? 'D' : point.kind === 'pickup' ? 'P' : point.kind === 'dropoff' ? 'D' : undefined,
        });
        markerOverlays.current.set(key, marker);
        return;
      }
      if (point.kind === 'driver') {
        const from = existing.getPosition?.();
        const startedAt = performance.now();
        const duration = 550;
        if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
        const animate = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / duration);
          const eased = 1 - (1 - progress) ** 3;
          existing.setPosition({
            lat: from ? from.lat() + (position.lat - from.lat()) * eased : position.lat,
            lng: from ? from.lng() + (position.lng - from.lng()) * eased : position.lng,
          });
          if (progress < 1) animationFrame.current = requestAnimationFrame(animate);
        };
        animationFrame.current = requestAnimationFrame(animate);
      } else {
        existing.setPosition(position);
      }
      existing.setTitle(point.label);
    });
    const activeDriver = points.find((point) => point.kind === 'driver');
    if (followDriver && activeDriver) map.panTo({ lat: activeDriver.latitude, lng: activeDriver.longitude });
    if (routeOverlay.current) {
      routeOverlay.current.setMap(null);
      routeOverlay.current = null;
    }
    const routePoints = encodedPolyline ? decodePolyline(encodedPolyline) : [];
    if (routePoints.length > 1) {
      routeOverlay.current = new maps.Polyline({
        path: routePoints, map, geodesic: true, strokeColor: '#F59E0B', strokeOpacity: 0.95, strokeWeight: 5,
      });
      routePoints.forEach((point) => bounds.extend(point));
    }
    if (!fittedInitialBounds.current && !userAdjustedViewport.current) {
      map.fitBounds(bounds, 42);
      fittedInitialBounds.current = true;
    }
  }, [encodedPolyline, pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude, driverLocation?.latitude, driverLocation?.longitude, showDemo, points.length, mapReady, followDriver]);

  useEffect(() => () => {
    if (animationFrame.current) cancelAnimationFrame(animationFrame.current);
    markerOverlays.current.forEach((marker) => marker.setMap(null));
    routeOverlay.current?.setMap(null);
    markerOverlays.current.clear();
  }, []);

  if (showDemo) {
    const displayPoints = points;
    return (
      <div className={`relative overflow-hidden rounded-xl border border-dashed border-[hsl(var(--chart-3))]/70 bg-[hsl(var(--secondary))] ${className}`} data-testid="demo-map">
        <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(45deg,transparent_48%,hsl(var(--primary))_49%,hsl(var(--primary))_51%,transparent_52%)] [background-size:18px_18px]" />
        <div className="relative flex min-h-48 flex-col justify-between p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[.14em] text-[hsl(var(--primary))]">{title}</p>
            <span className="rounded-full bg-[hsl(var(--chart-3))] px-2.5 py-1 text-[10px] font-extrabold tracking-wider text-[hsl(var(--primary))]">MAP UNAVAILABLE</span>
          </div>
          <div className="mx-auto flex w-4/5 items-center gap-2">
            <span className="size-3 rounded-full border-2 border-[hsl(var(--primary))] bg-[hsl(var(--card))]" />
            <span className="h-0.5 flex-1 border-t-2 border-dashed border-[hsl(var(--accent))]" />
            <span className="size-3 rotate-45 rounded-sm bg-[hsl(var(--accent))]" />
          </div>
          <div className="grid gap-1 text-xs font-semibold text-[hsl(var(--primary))]">
            {displayPoints.length ? displayPoints.slice(0, 3).map((point) => <span key={`${point.label}-${point.latitude}`}>{deliveryMapPointLabel(point)}</span>) : <span>{deliveryMapConfirmationMessage}</span>}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-[hsl(var(--muted-foreground))]">{webKey ? 'Live route mapping is temporarily unavailable. Confirmed locations will appear when it reconnects.' : 'Live route mapping is unavailable until a browser-safe Maps key is configured.'} No estimated location is shown.</p>
        </div>
      </div>
    );
  }

  return <div ref={mapNode} className={`min-h-48 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] ${className}`} aria-label={title} data-testid="google-map" />;
}