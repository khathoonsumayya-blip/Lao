import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/admin/admin-dashboard.tsx', import.meta.url), 'utf8');

test('Admin Dashboard checks subtitle', () => {
  assert.match(source, /Real-time platform operations\./);
});

test('Admin Dashboard has independent loading/error states for Dashboard, Deliveries, Audit', () => {
  assert.match(source, /isLoadingDashboard/);
  assert.match(source, /isErrorDashboard/);
  assert.match(source, /isLoadingDeliveries/);
  assert.match(source, /isErrorDeliveries/);
  assert.match(source, /isLoadingAudit/);
  assert.match(source, /isErrorAudit/);
});

test('Admin Dashboard uses useGetAdminDashboard and other correct hooks', () => {
  assert.match(source, /useGetAdminDashboard\(/);
  assert.match(source, /useListAdminAuditLogs\(/);
  assert.match(source, /useListAdminDeliveries\(/);
});
