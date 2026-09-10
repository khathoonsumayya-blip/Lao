import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetDeliveryQueryKey, getGetDeliveryRouteQueryKey } from '@workspace/api-client-react';
import { apiUrl } from '@/lib/api-url';

/**
 * The server replays its durable delivery-event ledger after this in-memory cursor. A
 * bounded reconnect is paired with React Query invalidation so polling and
 * normal route fetches still converge if event delivery is unavailable.
 */
export function useDeliveryEvents(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;
    let stopped = false;
    let cursor = '0';

    const refresh = (event?: MessageEvent) => {
      if (!event || event.type !== 'driver.location_updated') {
        if (event?.type === 'delivery.updated') {
          try {
            const update = JSON.parse(event.data) as { deliveryId?: string; payload?: { status?: string } };
            if (update.deliveryId && ['delivered', 'cancelled', 'failed', 'refunded'].includes(update.payload?.status ?? '')) {
              queryClient.setQueryData(getGetDeliveryRouteQueryKey(update.deliveryId), (previous: any) => previous
                ? { ...previous, driverLocation: null }
                : previous);
            }
          } catch {
            // The broad invalidation below still keeps status state convergent.
          }
        }
        queryClient.invalidateQueries();
        return;
      }
      try {
        const update = JSON.parse(event.data) as { deliveryId?: string; payload?: { id?: string; latitude?: number; longitude?: number; accuracyMeters?: number | null; capturedAt?: string } };
        const location = update.payload;
        if (!update.deliveryId || !location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number' || !location.capturedAt) return;
        queryClient.setQueryData(getGetDeliveryRouteQueryKey(update.deliveryId), (previous: any) => previous
          ? { ...previous, driverLocation: { ...location, deliveryId: update.deliveryId } }
          : previous);
        queryClient.invalidateQueries({ queryKey: getGetDeliveryRouteQueryKey(update.deliveryId) });
        queryClient.invalidateQueries({ queryKey: getGetDeliveryQueryKey(update.deliveryId) });
      } catch {
        queryClient.invalidateQueries();
      }
    };
    const connect = () => {
      if (stopped || !navigator.onLine) return;
      source?.close();
      source = new EventSource(apiUrl(`/api/events?cursor=${encodeURIComponent(cursor)}`), { withCredentials: true });
      const onEvent = (event: MessageEvent) => {
        attempt = 0;
        if (event.lastEventId) cursor = event.lastEventId;
        refresh(event);
      };
      source.addEventListener('delivery.updated', onEvent);
      source.addEventListener('driver.location_updated', onEvent);
      source.addEventListener('driver.availability_updated', onEvent);
      source.onerror = () => {
        source?.close();
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5));
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };
    const onOnline = () => { refresh(); connect(); };
    connect();
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      source?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, queryClient]);
}