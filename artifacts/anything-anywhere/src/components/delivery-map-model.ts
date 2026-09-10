export type DeliveryMapPoint = {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  label: string;
  kind?: 'pickup' | 'dropoff' | 'driver';
};

export function usableDeliveryMapPoint(point?: DeliveryMapPoint | null) {
  return point && point.latitude != null && point.longitude != null
    ? { latitude: point.latitude, longitude: point.longitude, label: point.label, kind: point.kind }
    : null;
}

export function deliveryMapPointLabel(point: NonNullable<ReturnType<typeof usableDeliveryMapPoint>>) {
  const kindLabel = point.kind === 'driver' ? 'Driver' : point.kind === 'dropoff' ? 'Destination' : 'Pickup';
  return `${kindLabel} · ${point.label}`;
}

export const deliveryMapConfirmationMessage = 'Confirm your pickup and delivery addresses to preview this route.';
