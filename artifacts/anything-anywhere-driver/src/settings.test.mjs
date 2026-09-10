import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const settings = await readFile(new URL('./pages/settings.tsx', import.meta.url), 'utf8');

test('Settings consolidates operations links', () => {
  const routes = ['/profile', '/vehicle', '/status', '/earnings', '/notifications', '/help'];
  for (const route of routes) {
    assert.match(settings, new RegExp(`href="${route}"`));
  }
});

test('Settings exposes driver preference controls', () => {
  assert.match(settings, /useGetDriverSettings/);
  assert.match(settings, /useUpdateDriverSettings/);
  assert.match(settings, /notificationSound/);
  assert.match(settings, /navigationApp/);
  assert.match(settings, /vibration/);
  assert.match(settings, /preferredMaxRangeMiles/);
});

test('Settings provides location permissions guidance', () => {
  assert.match(settings, /Location Permission/);
  assert.match(settings, /Managed by your browser or device settings/);
  assert.match(settings, /settings\.location\.status/);
});

test('Settings provides security and logout functionality', () => {
  assert.match(settings, /Password & Authentication/);
  assert.match(settings, /await signOut\(\)/);
  assert.match(settings, /setLocation\('\/welcome', \{ replace: true \}\)/);
});
