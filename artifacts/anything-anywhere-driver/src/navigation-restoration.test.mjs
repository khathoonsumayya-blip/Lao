import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('./App.tsx');
const layout = read('./components/layout.tsx');
const home = read('./pages/home.tsx');
const active = read('./pages/active-delivery.tsx');
const rewards = read('./pages/rewards.tsx');
const support = read('./pages/support.tsx');
const detail = read('./pages/delivery-detail.tsx');

test('every restored Driver destination maps to a real route', () => {
  for (const route of [
    '/available-deliveries', '/active-delivery', '/history', '/earnings', '/rewards',
    '/notifications', '/profile', '/profile/edit', '/vehicle', '/settings', '/status',
    '/help', '/support', '/safety', '/delivery/:id', '/deliveries/:deliveryId',
  ]) {
    assert.match(app, new RegExp(`<Route path=\"${route.replace(/[/:]/g, '\\$&')}\"`));
  }
});

test('persistent menu exposes all Driver sections and logout', () => {
  for (const label of [
    'Available Deliveries', 'Active Delivery', 'Delivery History', 'Earnings',
    'Rewards & Bonuses', 'Notifications', 'Profile', 'Vehicle & Documents',
    'Onboarding Status', 'Settings', 'Help & Support', 'Safety & Issue Reports',
  ]) assert.ok(layout.includes(`label: '${label}'`), `${label} is missing from Driver menu`);
  assert.match(layout, /data-testid="button-menu-logout"/);
  assert.match(layout, /data-testid="nav-more"/);
  assert.match(layout, /menuOpen && profile/);
});

test('restored destinations retain live Driver functionality', () => {
  assert.match(home, /location === '\/available-deliveries'/);
  assert.match(active, /useListDriverDeliveries/);
  assert.match(active, /setLocation\(`\/deliveries\/\$\{active\.id\}`/);
  assert.match(rewards, /useGetDriverBonusWallet/);
  assert.match(support, /href="\/safety"/);
  assert.match(support, /href="\/notifications"/);
  assert.match(detail, /useUpdateDriverLocation/);
  assert.match(detail, /useVerifyDriverRecipient/);
});