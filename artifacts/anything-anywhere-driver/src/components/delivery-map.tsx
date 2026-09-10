import { useEffect, useRef, useState } from 'react';

export type MapPoint = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  label: string;
  kind?: 'pickup' | 'dropoff' | 'driver';
};

type DeliveryMapProps = {
  pickup?: MapPoint;
  dropoff?: MapPoint;
  driverLocation?: MapPoint | null;
  encodedPolyline?: string | null;
  demoMode?: boolean;
};

function usablePoint(point?: MapPoint | null) {
  return point && point.latitude != null && point.longitude != null ? point : null;
}

function loadGoogleMaps(key: string): Promise<void> {
  const googleWindow = window as Window & { google?: { maps?: unknown }; __aaDriverMapsPromise?: Promise<void> };
  if (googleWindow.google?.maps) return Promise.resolve();
  if (googleWindow.__aaDriverMapsPromise) return googleWindow.__aaDriverMapsPromise;
  googleWindow.__aaDriverMapsPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps could not load.'));
    document.head.appendChild(script);
  });
  return googleWindow.__aaDriverMapsPromise;
}

function decodePolyline(encoded: string) {
  const path: Array<{ lat: number; lng: number }> = [];
  let index = 0; let latitude = 0; let longitude = 0;
  while (index < encoded.length) {
    let shift = 0; let result = 0; let byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    path.push({ lat: latitude / 1e5, lng: longitude / 1e5 });
  }
  return path;
}

export function DeliveryMap({ pickup, dropoff, driverLocation, encodedPolyline, demoMode = false }: DeliveryMapProps) {
  const mapNode = useRef<HTMLDivElement>(null);
  const webKey = import.meta.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY as string | undefined;
  const [unavailable, setUnavailable] = useState(false);
  const points = [pickup, dropoff, driverLocation].map(usablePoint).filter((point): point is MapPoint => Boolean(point));
  const useDemo = demoMode || !webKey || unavailable;

  useEffect(() => {
    if (useDemo || !webKey || !mapNode.current || !points.length) return;
    let active = true;
    void loadGoogleMaps(webKey).then(() => {
      if (!active || !mapNode.current) return;
      const maps = (window as any).google.maps;
      const map = new maps.Map(mapNode.current, {
        center: { lat: points[0].latitude, lng: points[0].longitude },
        zoom: 13,
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'cooperative',
      });
      const bounds = new maps.LatLngBounds();
      points.forEach((point) => {
        const position = { lat: point.latitude, lng: point.longitude };
        bounds.extend(position);
        new maps.Marker({ map, position, title: point.label, label: point.kind === 'driver' ? 'D' : undefined });
      });
      if (pickup && dropoff && usablePoint(pickup) && usablePoint(dropoff)) {
        new maps.Polyline({
          path: encodedPolyline ? decodePolyline(encodedPolyline) : [{ lat: pickup.latitude, lng: pickup.longitude }, { lat: dropoff.latitude, lng: dropoff.longitude }],
          map,
          geodesic: true,
          strokeColor: '#F59E0B',
          strokeOpacity: 0.95,
          strokeWeight: encodedPolyline ? 5 : 3,
        });
      }
      if (points.length > 1) map.fitBounds(bounds, 36);
    }).catch(() => setUnavailable(true));
    return () => { active = false; };
  }, [pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude, driverLocation?.latitude, driverLocation?.longitude, webKey, useDemo, points.length, encodedPolyline]);

  if (useDemo) return <div className="relative min-h-48 overflow-hidden rounded-xl border border-dashed border-primary/40 bg-secondary p-4" data-testid="driver-demo-map"><div className="absolute inset-0 opacity-20 [background-image:linear-gradient(45deg,transparent_48%,currentColor_49%,currentColor_51%,transparent_52%)] [background-size:18px_18px]" /><div className="relative flex h-full min-h-40 flex-col justify-between"><span className="w-fit rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold tracking-wider text-primary-foreground">DEMO MAP MODE</span><div className="flex items-center gap-2"><span className="size-3 rounded-full border-2 border-primary bg-background" /><span className="flex-1 border-t-2 border-dashed border-primary" /><span className="size-3 rotate-45 rounded-sm bg-primary" /></div><p className="text-xs leading-5 text-muted-foreground">Sample Raleigh route only. Use the manifest address, not this preview, for navigation.</p></div></div>;
  return <div ref={mapNode} className="min-h-48 overflow-hidden rounded-xl border border-border bg-secondary" aria-label="Active delivery map" data-testid="driver-google-map" />;
}