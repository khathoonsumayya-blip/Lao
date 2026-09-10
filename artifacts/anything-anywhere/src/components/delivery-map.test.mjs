import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  deliveryMapConfirmationMessage,
  deliveryMapPointLabel,
  usableDeliveryMapPoint,
} from './delivery-map-model.ts';

test('no valid coordinates produce only the neutral unavailable confirmation', () => {
  const points = [
    { latitude: null, longitude: null, label: 'Unconfirmed pickup', kind: 'pickup' },
    { latitude: undefined, longitude: -122.4, label: 'Incomplete destination', kind: 'dropoff' },
  ].map(usableDeliveryMapPoint).filter(Boolean);

  assert.deepEqual(points, []);
  assert.equal(
    deliveryMapConfirmationMessage,
    'Confirm your pickup and delivery addresses to preview this route.',
  );
  assert.doesNotMatch(deliveryMapConfirmationMessage, /\b(?:new york|los angeles|chicago|san francisco|austin|seattle|miami|boston)\b/i);
});

test('valid provider coordinates render their supplied pickup, destination, and driver labels', () => {
  const supplied = [
    { latitude: 47.6205, longitude: -122.3493, label: 'Provider pickup', kind: 'pickup' },
    { latitude: 47.6097, longitude: -122.3331, label: 'Provider destination', kind: 'dropoff' },
    { latitude: 47.615, longitude: -122.34, label: 'Provider driver', kind: 'driver' },
  ];

  const rendered = supplied.map(usableDeliveryMapPoint).filter(Boolean).map(deliveryMapPointLabel);

  assert.deepEqual(rendered, [
    'Pickup · Provider pickup',
    'Destination · Provider destination',
    'Driver · Provider driver',
  ]);
});

test('customer map production sources contain no sample coordinates or city-specific fallback', async () => {
  const sources = await Promise.all([
    readFile(new URL('./delivery-map.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../pages/customer-pages.tsx', import.meta.url), 'utf8'),
  ]);
  const productionSource = sources.join('\n');

  assert.doesNotMatch(
    productionSource,
    /(?:37\.7749\s*,?\s*-122\.4194|40\.7128\s*,?\s*-74\.006(?:0)?|34\.0522\s*,?\s*-118\.2437)/,
    'Sample map coordinates must not be used in customer map production code.',
  );
  assert.doesNotMatch(
    productionSource,
    /(?:map|route|location)[^.\n]{0,100}\b(?:new york|los angeles|chicago|san francisco|austin|seattle|miami|boston)\b/i,
    'Map fallback copy must remain location-neutral.',
  );
});
