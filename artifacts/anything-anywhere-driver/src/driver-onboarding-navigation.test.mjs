import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, onboarding, session, profile] = await Promise.all([
  readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/onboarding.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./lib/driver-session.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/profile.tsx', import.meta.url), 'utf8'),
]);

test('unauthenticated onboarding redirects to Driver sign-in with replacement history', () => {
  assert.match(app, /status === 401 \|\| status === 403\) setLocation\('\/welcome', \{ replace: true \}\)/);
  assert.match(app, /if \(!profileQuery\.data && !isWelcome\) return null/);
});

test('Driver onboarding exposes usable Back and Logout actions', () => {
  assert.match(onboarding, /data-testid="button-onboarding-back"/);
  assert.match(onboarding, /data-testid="button-onboarding-logout"/);
  assert.match(onboarding, /if \(location === '\/status'\) setLocation\('\/settings'\)/);
  assert.match(onboarding, /else setLocation\('\/welcome', \{ replace: true \}\)/);
  assert.match(onboarding, /await signOut\(\)/);
});

test('Driver logout revokes the server session and clears cached authenticated state', () => {
  assert.match(session, /apiUrl\('\/api\/auth\/signout'\)/);
  assert.match(session, /method: 'POST'/);
  assert.match(session, /credentials: 'include'/);
  assert.match(session, /setSignedOut\(true\)/);
  assert.match(session, /queryClient\.clear\(\)/);
  assert.match(profile, /await signOut\(\)/);
  assert.match(profile, /setLocation\('\/welcome', \{ replace: true \}\)/);
});
