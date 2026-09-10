import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListDriverDeliveriesQueryKey,
  getListDriverOffersQueryKey,
  getGetDriverProfileQueryKey,
  getGetDriverEarningsQueryKey
} from '@workspace/api-client-react';
import { apiUrl } from '@/lib/api-url';

export function useDriverEvents(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let pollTimer: number | null = null;
    let attempt = 0;
    let stopped = false;
    let cursor = '0';
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: getListDriverDeliveriesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListDriverOffersQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDriverProfileQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDriverEarningsQueryKey() });
    };
    const connect = () => {
      if (stopped || !navigator.onLine) return;
      source?.close();
      source = new EventSource(apiUrl(`/api/events?cursor=${encodeURIComponent(cursor)}`), { withCredentials: true });
      const handleEvent = (event: MessageEvent) => {
        attempt = 0;
        if (event.lastEventId) cursor = event.lastEventId;
        invalidate();
      };
      source.addEventListener('delivery.updated', handleEvent);
      source.addEventListener('driver.location_updated', handleEvent);
      source.addEventListener('driver.availability_updated', handleEvent);
      source.onerror = () => {
        source?.close();
        reconnectTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5)));
      };
    };
    const onOnline = () => { invalidate(); connect(); };
    connect();
    pollTimer = window.setInterval(invalidate, 15_000);
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      source?.close();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      window.removeEventListener('online', onOnline);
    };
  }, [enabled, queryClient]);
}
