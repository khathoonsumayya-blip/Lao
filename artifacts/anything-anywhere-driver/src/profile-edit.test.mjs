import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, profile, editor] = await Promise.all([
  readFile(new URL('./App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/profile.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./pages/profile-edit.tsx', import.meta.url), 'utf8'),
]);

test('driver profile exposes an authenticated edit route and action', () => {
  assert.match(app, /<Route path="\/profile\/edit" component={ProfileEdit}/);
  assert.match(profile, /setLocation\('\/profile\/edit'\)/);
});

test('profile editor uses session-scoped changed-field mutation and refreshes profile data', () => {
  assert.match(editor, /useUpdateDriverProfile/);
  assert.match(editor, /updateProfile\.mutate\(\{ data: changed \}/);
  assert.doesNotMatch(editor, /driverId/);
  assert.match(editor, /getGetDriverProfileQueryKey\(\)/);
  assert.match(editor, /getGetDriverOnboardingQueryKey\(\)/);
});

test('profile editor protects unsaved work and reuses secure document upload flow', () => {
  assert.match(editor, /beforeunload/);
  assert.match(editor, /Discard your unsaved profile changes/);
  assert.match(editor, /documents\/upload-url/);
  assert.match(editor, /credentials: 'include'/);
  assert.match(editor, /verificationStatus/);
  assert.match(editor, /expiryDate/);
  assert.match(editor, /rejectionReason/);
  assert.match(editor, /Private profile photo/);
});

test('profile editor supports completeness safe fields and compliance vehicle year', () => {
  for (const field of ['address', 'emergencyContactName', 'emergencyContactPhone', 'vehicleYear']) {
    assert.match(editor, new RegExp(field));
  }
  assert.match(editor, /Vehicle year must be a whole year from 1990 through 2100/);
  assert.match(editor, /Enter the document expiration date before replacing it/);
  assert.match(editor, /\.\.\.\(needsExpiry \? \{ expiryDate \} : \{\}\)/);
  assert.doesNotMatch(editor, /expiryDate: new Date\(expiryDate\)\.toISOString\(\)/);
});

test('both document upload paths preserve the date-input contract', async () => {
  const onboarding = await readFile(new URL('./pages/onboarding.tsx', import.meta.url), 'utf8');
  assert.match(onboarding, /existingDoc\?\.expiryDate\?\.slice\(0, 10\)/);
  assert.match(onboarding, /Enter the document expiration date before uploading/);
  assert.match(onboarding, /\.\.\.\(needsExpiry \? \{ expiryDate \} : \{\}\)/);
  assert.doesNotMatch(onboarding, /expiryDate: new Date\(expiryDate\)\.toISOString\(\)/);
});

test('profile summary exposes pending and rejected compliance review results', () => {
  assert.match(profile, /profile\.complianceReviewStatus/);
  assert.match(profile, /Pending review/);
  assert.match(profile, /profile\.complianceReviewReason/);
  assert.match(profile, /Edit and resubmit/);
});