import { useLocation } from 'wouter';
import { useListNotifications } from '@workspace/api-client-react';

function formatTimestamp(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? null
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);
}

export default function Notifications() {
  const [, setLocation] = useLocation();
  const notifications = useListNotifications();

  const openNotification = (notification: { supportSource: string | null; supportId: string | null }) => {
    if (notification.supportSource === 'driver_issue' && notification.supportId) {
      setLocation(`/safety?issue=${encodeURIComponent(notification.supportId)}`);
      return;
    }
    // Delivery notifications continue to return drivers to their Route screen.
    setLocation('/');
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h1 className="font-display text-3xl font-bold uppercase mb-2">Notifications</h1>
      <p className="text-muted-foreground mb-6">Updates for your route and dispatch conversations.</p>
      {notifications.isLoading && <p role="status" className="driver-card p-6 text-center text-muted-foreground" data-testid="status-notifications-loading">Loading notifications…</p>}
      {notifications.isError && <div role="alert" className="driver-card p-6 text-center"><p>We could not load notifications.</p><button type="button" onClick={() => notifications.refetch()} className="driver-btn driver-btn-primary mt-4" data-testid="button-retry-notifications">Try again</button></div>}
      {!notifications.isLoading && !notifications.isError && notifications.data?.length === 0 && <div className="driver-card p-6 text-center" data-testid="text-notifications-empty"><p className="font-bold">You have no notifications yet.</p><p className="mt-2 text-sm text-muted-foreground">New offers and delivery updates will appear here.</p></div>}
      {!notifications.isLoading && !notifications.isError && Boolean(notifications.data?.length) && <div className="space-y-3" data-testid="list-notifications">
        {notifications.data?.map((notification) => {
          const createdAt = formatTimestamp(notification.createdAt);
          const opensSupport = notification.supportSource === 'driver_issue' && notification.supportId;
          return <button key={notification.id} type="button" onClick={() => openNotification(notification)} className="driver-card w-full p-4 text-left hover:bg-secondary/40 transition-colors" data-testid={`button-notification-${notification.id}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><h2 className="font-bold break-words">{notification.title}</h2><p className="mt-1 text-sm text-muted-foreground break-words">{notification.body}</p></div>
              {notification.readAt === null && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>{createdAt ?? 'Recent'}</span><span className="font-bold">{opensSupport ? 'Open conversation' : 'Open Route'}</span>
            </div>
          </button>;
        })}
      </div>}
    </div>
  );
}