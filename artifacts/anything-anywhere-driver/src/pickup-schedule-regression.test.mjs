import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile(new URL('./pages/home.tsx', import.meta.url), 'utf8');
const detail = await readFile(new URL('./pages/delivery-detail.tsx', import.meta.url), 'utf8');
const history = await readFile(new URL('./pages/history.tsx', import.meta.url), 'utf8');
const formatter = await readFile(new URL('./lib/pickup-schedule.ts', import.meta.url), 'utf8');

test('Driver displays generated pickup schedule in offers, active routes, history, and detail', () => {
  assert.match(home, /formatPickupSchedule\(/);
  assert.match(home, /scheduledPickupStartAt/);
  assert.match(history, /formatPickupSchedule\(/);
  assert.match(detail, /formatPickupSchedule\(/);
  assert.match(detail, /scheduledPickupStartAt/);
});

test('Driver pickup formatter labels missing windows ASAP and never uses createdAt', () => {
  assert.match(formatter, /return 'ASAP'/);
  assert.doesNotMatch(formatter, /createdAt/);
});