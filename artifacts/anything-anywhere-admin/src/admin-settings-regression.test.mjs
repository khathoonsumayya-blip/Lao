import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const indexSource = await readFile(new URL('./pages/admin/settings/index.tsx', import.meta.url), 'utf8');
const generalSource = await readFile(new URL('./pages/admin/settings/general.tsx', import.meta.url), 'utf8');
const usersSource = await readFile(new URL('./pages/admin/settings/users.tsx', import.meta.url), 'utf8');
const dispatchSource = await readFile(new URL('./pages/admin/settings/dispatch.tsx', import.meta.url), 'utf8');
const promotionsSource = await readFile(new URL('./pages/admin/settings/promotions.tsx', import.meta.url), 'utf8');
const securitySource = await readFile(new URL('./pages/admin/settings/security.tsx', import.meta.url), 'utf8');
const paymentsSource = await readFile(new URL('./pages/admin/settings/payments.tsx', import.meta.url), 'utf8');
const emailSource = await readFile(new URL('./pages/admin/settings/email.tsx', import.meta.url), 'utf8');
const integrationsSource = await readFile(new URL('./pages/admin/settings/integrations.tsx', import.meta.url), 'utf8');
const systemSource = await readFile(new URL('./pages/admin/settings/system.tsx', import.meta.url), 'utf8');
const auditSource = await readFile(new URL('./pages/admin/settings/audit.tsx', import.meta.url), 'utf8');

test('Admin Settings Index has required tabs', () => {
  assert.match(indexSource, /general/);
  assert.match(indexSource, /users/);
  assert.match(indexSource, /dispatch/);
  assert.match(indexSource, /promotions/);
  assert.match(indexSource, /security/);
  assert.match(indexSource, /payments/);
  assert.match(indexSource, /email/);
  assert.match(indexSource, /integrations/);
  assert.match(indexSource, /system/);
  assert.match(indexSource, /audit/);
});

test('Admin General Settings uses required hooks', () => {
  assert.match(generalSource, /useGetAdminSettings\(/);
  assert.match(generalSource, /useUpdateAdminGeneralSettings\(/);
  assert.match(generalSource, /Save Changes/);
});

test('Admin Users Settings uses required hooks', () => {
  assert.match(usersSource, /useListAdminSettingsUsers\(/);
  assert.match(usersSource, /useUpdateAdminSettingsUser\(/);
  assert.match(usersSource, /useRevokeAdminSettingsUserSessions\(/);
  assert.match(usersSource, /Revoke Sessions/);
});

test('Admin Dispatch Settings uses required hooks', () => {
  assert.match(dispatchSource, /useGetAdminDispatchSettings\(/);
  assert.match(dispatchSource, /useUpdateAdminDispatchSettings\(/);
  assert.match(dispatchSource, /Save/);
});

test('Admin Promotions Settings uses required hooks', () => {
  assert.match(promotionsSource, /useListAdminPromotions\(/);
  assert.match(promotionsSource, /useCreateAdminPromotion\(/);
  assert.match(promotionsSource, /useUpdateAdminPromotion\(/);
  assert.match(promotionsSource, /useUpdateAdminPromotionStatus\(/);
});

test('Admin Security Settings uses required hooks', () => {
  assert.match(securitySource, /useGetAdminSecuritySettings\(/);
  assert.match(securitySource, /useUpdateAdminSecuritySettings\(/);
  assert.match(securitySource, /useRevokeOtherAdminSessions\(/);
  assert.match(securitySource, /Revoke Other Sessions/);
});

test('Admin Payments Settings uses required hooks', () => {
  assert.match(paymentsSource, /useGetAdminPaymentFeeSettings\(/);
  assert.match(paymentsSource, /useUpdateAdminPaymentFeeSettings\(/);
  assert.match(paymentsSource, /new quotes/i);
});

test('Admin Email Settings uses required hooks', () => {
  assert.match(emailSource, /useGetAdminEmailSettings\(/);
  assert.match(emailSource, /useUpdateAdminEmailSettings\(/);
  assert.match(emailSource, /useSendAdminSettingsTestEmail\(/);
  assert.match(emailSource, /Send Test Email/);
});

test('Admin Integrations Settings uses required hooks', () => {
  assert.match(integrationsSource, /useGetAdminIntegrationHealth\(/);
});

test('Admin System Settings uses required hooks', () => {
  assert.match(systemSource, /useGetAdminSystemStatus\(/);
});

test('Admin Audit Settings uses required hooks', () => {
  assert.match(auditSource, /useListAdminAuditLogs\(/);
});
