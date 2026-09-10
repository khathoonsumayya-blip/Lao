import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, shell, detail] = await Promise.all([
  readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./components/layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/delivery-detail.tsx', import.meta.url), 'utf8'),
]);

test('every authenticated route is contained by the authoritative driver shell', () => {
  assert.match(app, /<DriverAppShell>[\s\S]*<RoutedErrorBoundary>[\s\S]*<Switch>/);
  assert.match(app, /<\/RoutedErrorBoundary>\s*<\/DriverAppShell>/);
});

test('persistent navigation has the required destinations and finds active deliveries', () => {
  for (const label of ['Home', 'Available Deliveries', 'Active Delivery', 'Earnings', 'Delivery History', 'Profile']) {
    assert.match(shell, new RegExp(`label: '${label}'`));
  }
  assert.match(shell, /useListDriverDeliveries/);
  assert.match(shell, /!terminalDeliveryStatuses\.includes\(delivery\.status\)/);
  assert.match(shell, /href: activeDelivery \? `\/deliveries\/\$\{activeDelivery\.id\}` : '\/active-delivery'/);
  assert.match(shell, /fixed bottom-0 left-0 right-0/);
});

test('route aliases preserve delivery detail navigation and its persistent return link', () => {
  for (const route of ['/home', '/orders', '/deliveries', '/deliveries/:deliveryId', '/delivery/:id']) {
    assert.match(app, new RegExp(`<Route path="${route.replace('/', '\\/')}"`));
  }
  assert.match(detail, /useRoute\('\/deliveries\/:deliveryId'\)/);
  assert.match(detail, /setLocation\('\/deliveries'\)/);
});