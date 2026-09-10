import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bookingDraftStorageKey,
  clearBookingRouteDraft,
  readBookingRouteDraft,
  writeBookingRouteDraft,
} from './booking-route-draft.ts';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('selected pickup and drop-off survive booking-page initialization and refresh', () => {
  const storage = memoryStorage();
  const draft = {
    pickupAddress: '350 5th Ave, New York, NY 10118, USA',
    dropoffAddress: '11 Wall St, New York, NY 10005, USA',
    pickupSelection: { address: '350 5th Ave, New York, NY 10118, USA', latitude: 40.7484, longitude: -73.9857 },
    dropoffSelection: { address: '11 Wall St, New York, NY 10005, USA', latitude: 40.7069, longitude: -74.0094 },
  };

  writeBookingRouteDraft(storage, draft);
  assert.deepEqual(readBookingRouteDraft(storage), draft);
  assert.deepEqual(readBookingRouteDraft(storage), draft);
});

test('scheduled priority, date, and window survive a booking draft round trip', () => {
  const storage = memoryStorage();
  const draft = {
    pickupAddress: 'Pickup',
    dropoffAddress: 'Drop-off',
    priority: 'scheduled',
    scheduledPickupDate: '2099-06-15',
    scheduledPickupWindow: '10:00',
  };
  writeBookingRouteDraft(storage, draft);
  assert.deepEqual(readBookingRouteDraft(storage), draft);
  clearBookingRouteDraft(storage);
  assert.deepEqual(readBookingRouteDraft(storage), {});
});

test('completed or abandoned customer sessions can clear the route draft', () => {
  const storage = memoryStorage();
  writeBookingRouteDraft(storage, { pickupAddress: 'Pickup', dropoffAddress: 'Drop-off' });
  clearBookingRouteDraft(storage);
  assert.equal(storage.getItem(bookingDraftStorageKey), null);
  assert.deepEqual(readBookingRouteDraft(storage), {});
});

test('invalid stored route drafts fail safely', () => {
  const storage = memoryStorage();
  storage.setItem(bookingDraftStorageKey, '{not valid json');
  assert.deepEqual(readBookingRouteDraft(storage), {});
});