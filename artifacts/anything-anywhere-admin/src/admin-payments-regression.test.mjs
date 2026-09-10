import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/admin/admin-payments.tsx', import.meta.url), 'utf8');

test('Admin Payments uses required hooks', () => {
  assert.match(source, /useListAdminPayments\(/);
  assert.match(source, /useRequestAdminPaymentRefund\(/);
});

test('Admin Payments has loading and error states', () => {
  assert.match(source, /isLoading/);
  assert.match(source, /isError/);
  assert.match(source, /Loading payments\.\.\./);
});

test('Admin Payments renders proper data', () => {
  assert.match(source, /Gross Revenue/);
  assert.match(source, /payment\.status/);
  assert.match(source, /Request Refund/);
});

test('Admin Payments uses useGetAdminPaymentsSummary for aggregate cards', () => {
  assert.match(source, /useGetAdminPaymentsSummary\(/);
  assert.match(source, /Platform Revenue/);
  assert.match(source, /summary\.grossPaidRevenue/);
  assert.match(source, /isLoadingSummary/);
});
