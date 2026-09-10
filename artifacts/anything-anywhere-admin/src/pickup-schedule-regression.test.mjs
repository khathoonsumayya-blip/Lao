import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const deliveries = await readFile(new URL('./pages/admin/admin-deliveries.tsx', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('./pages/admin/admin-dashboard.tsx', import.meta.url), 'utf8');
const formatter = await readFile(new URL('./lib/pickup-schedule.ts', import.meta.url), 'utf8');

test('Admin primary deliveries and dashboard show the generated pickup window', () => {
  assert.match(deliveries, /formatPickupSchedule\(/);
  assert.match(deliveries, /scheduledPickupStartAt/);
  assert.match(dashboard, /formatPickupSchedule\(/);
  assert.match(dashboard, /scheduledPickupStartAt/);
});

test('Admin pickup formatter explicitly labels unscheduled deliveries ASAP', () => {
  assert.match(formatter, /return 'ASAP'/);
  assert.doesNotMatch(formatter, /createdAt/);
});