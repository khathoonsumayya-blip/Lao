import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pickupScheduleTimestamps, pickupWindows } from './lib/pickup-schedule.ts';

const bookingSource = readFileSync(new URL('./pages/customer-pages.tsx', import.meta.url), 'utf8');
const shellSource = readFileSync(new URL('./components/app-shell.tsx', import.meta.url), 'utf8');

test('accepts a valid future pickup window and returns ISO fields', () => {
  const result = pickupScheduleTimestamps('2099-06-15', '10:00');
  assert.ok(result);
  assert.match(result.start, /^2099-06-15T/);
  assert.match(result.end, /^2099-06-15T/);
  assert.ok(new Date(result.end) > new Date(result.start));
});

test('rejects malformed, past, reversed, and unavailable pickup windows', () => {
  assert.equal(pickupScheduleTimestamps('not-a-date', '10:00'), null);
  assert.equal(pickupScheduleTimestamps('2020-01-01', '10:00'), null);
  assert.equal(pickupScheduleTimestamps('2099-06-15', '09:00'), null);
  assert.equal(pickupScheduleTimestamps('2099-06-15', ''), null);
  assert.equal(pickupWindows.some(([start]) => start === '09:00'), false);
});

test('scheduled selection immediately owns persistent mobile date and window controls', () => {
  assert.match(bookingSource, /form\.priority === 'scheduled' \? <ScheduleControls/);
  assert.match(bookingSource, /data-testid="controls-scheduled-pickup"/);
  assert.match(bookingSource, /data-testid="input-pickup-date"/);
  assert.match(bookingSource, /data-testid="select-pickup-window"/);
  assert.match(bookingSource, /min=\{today\}/);
  assert.match(bookingSource, /scheduledPickupDate: form\.scheduledPickupDate/);
  assert.match(bookingSource, /scheduledPickupWindow: form\.scheduledPickupWindow/);
});

test('quote, review, list, and detail surfaces keep the selected pickup window visible', () => {
  assert.match(bookingSource, /scheduledPickupStartAt: scheduledTimestamps\.start/);
  assert.match(bookingSource, /scheduledPickupEndAt: scheduledTimestamps\.end/);
  assert.match(bookingSource, /data-testid="text-quote-pickup-window"/);
  assert.match(bookingSource, /testId="scheduled-pickup-review"/);
  assert.match(bookingSource, /data-testid=\{`text-delivery-window-\$\{delivery\.id\}`\}/);
  assert.match(shellSource, /data-testid="scheduled-pickup-detail"/);
});
