import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '@/lib/api-url';
export function useDeliveryEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false; let source: EventSource | undefined; let timer: number | undefined; let cursor = '0'; let attempt = 0;
    const connect = () => { if (stopped || !navigator.onLine) return; source?.close(); source = new EventSource(apiUrl(`/api/events?cursor=${encodeURIComponent(cursor)}`), { withCredentials: true }); const refresh = (event: MessageEvent) => { cursor = event.lastEventId || cursor; attempt = 0; queryClient.invalidateQueries(); }; source.addEventListener('delivery.updated', refresh); source.addEventListener('driver.location_updated', refresh); source.addEventListener('driver.availability_updated', refresh); source.addEventListener('admin.updated', refresh); source.onerror = () => { source?.close(); timer = window.setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5))); }; };
    connect(); return () => { stopped = true; source?.close(); if (timer) window.clearTimeout(timer); };
  }, [enabled, queryClient]);
}