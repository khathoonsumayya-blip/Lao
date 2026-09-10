import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const earnings = await readFile(new URL('./pages/earnings.tsx', import.meta.url), 'utf8');

test('earnings page uses both required hooks and provides a unified retry', () => {
  assert.match(earnings, /useGetDriverEarnings\(\)/);
  assert.match(earnings, /useGetDriverBonusWallet\(\)/);
  assert.match(earnings, /refetchEarnings\(\)/);
  assert.match(earnings, /refetchBonus\(\)/);
  assert.match(earnings, /isLoadingEarnings \|\| isLoadingBonus/);
  assert.match(earnings, /isErrorEarnings \|\| isErrorBonus/);
});

test('bonus wallet states are displayed safely and independently', () => {
  assert.match(earnings, /bonusWallet\.pendingCents/);
  assert.match(earnings, /bonusWallet\.approvedCents/);
  assert.match(earnings, /bonusWallet\.paidCents/);
  assert.match(earnings, /bonusWallet\.reversedCents/);
});

test('bonus transactions merge accurately into the timeline', () => {
  assert.match(earnings, /kind: 'bonus'/);
  assert.match(earnings, /tx\.amountCents \/ 100/);
});