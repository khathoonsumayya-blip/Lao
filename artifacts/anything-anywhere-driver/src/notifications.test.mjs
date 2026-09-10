import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const notifications = await readFile(new URL('./pages/notifications.tsx', import.meta.url), 'utf8');

test('notifications use the session-scoped generated list hook with recoverable states', () => {
  assert.match(notifications, /useListNotifications/);
  assert.match(notifications, /notifications\.isLoading/);
  assert.match(notifications, /notifications\.isError/);
  assert.match(notifications, /notifications\.refetch\(\)/);
  assert.match(notifications, /text-notifications-empty/);
});

test('driver issue notifications preserve safe issue deep-links and deliveries return to route', () => {
  assert.match(notifications, /notification\.supportSource === 'driver_issue' && notification\.supportId/);
  assert.match(notifications, /`\/safety\?issue=\$\{encodeURIComponent\(notification\.supportId\)\}`/);
  assert.match(notifications, /setLocation\('\/'\)/);
});