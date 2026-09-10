import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = await readFile(new URL('./pages/home.tsx', import.meta.url), 'utf8');

test('home page wires up useDeclineDriverDelivery', () => {
  assert.match(home, /useDeclineDriverDelivery/);
  assert.match(home, /declineDelivery\.mutate/);
});

test('decline action uses explicit confirmation', () => {
  assert.match(home, /decliningOfferId === offer\.id/);
  assert.match(home, /Are you sure you want to decline this offer\?/);
  assert.match(home, /button-confirm-decline-/);
});

test('both accept and decline buttons are disabled while mutations are pending', () => {
  assert.match(home, /disabled=\{acceptDelivery\.isPending \|\| declineDelivery\.isPending\}/);
  assert.match(home, /disabled=\{declineDelivery\.isPending \|\| acceptDelivery\.isPending\}/); // For the confirm buttons
});

test('shows a non-destructive inline error', () => {
  assert.match(home, /declineDelivery\.isError && decliningOfferId === offer\.id/);
  assert.match(home, /Failed to decline delivery\. Please try again\./);
});

test('refetches offers on success', () => {
  assert.match(home, /queryClient\.invalidateQueries\(\{ queryKey: getListDriverOffersQueryKey\(\) \}\)/);
});
