import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/admin/admin-drivers.tsx', import.meta.url), 'utf8');

test('Admin Drivers lists required hooks', () => {
  assert.match(source, /useListAdminDriverReview/);
  assert.match(source, /useGetAdminDriverReview/);
  assert.match(source, /useDecideAdminDriver/);
  assert.match(source, /useReviewAdminDriverDocument/);
  assert.match(source, /useCreateAdminDriverDocumentDownloadUrl/);
  assert.match(source, /useAdjudicateAdminDriverBackgroundCheck/);
  assert.match(source, /useAdjudicateAdminDriverMvr/);
  assert.match(source, /useReviewAdminDriverProfileUpdate/);
});

test('Admin Drivers distinguishes loading, error, empty, and populated states for list', () => {
  assert.match(source, /Loading drivers\.\.\./);
  assert.match(source, /Failed to load drivers/);
  assert.match(source, /No drivers found/);
  assert.match(source, /filteredRows\.length === 0/);
});

test('Admin Drivers uses correct properties for AdminDriverReviewListItem', () => {
  assert.match(source, /row\.firstName/);
  assert.match(source, /row\.lastName/);
  assert.match(source, /row\.approvalStatus/);
});

test('Admin Drivers shows placeholders for missing documents', () => {
  assert.match(source, /Missing/);
  assert.match(source, /const reqDocTypes = \['license', 'insurance', 'vehicle_registration'\];/);
});

test('Admin Drivers rejection requires reason', () => {
  assert.match(source, /reason is required for \$\{decision\}/i);
});

test('Admin Drivers exposes background check and MVR adjudication fields', () => {
  assert.match(source, /useAdjudicateAdminDriverBackgroundCheck/);
  assert.match(source, /useAdjudicateAdminDriverMvr/);
  assert.match(source, /Background Check/);
  assert.match(source, /MVR Check/);
});

test('Admin Drivers exposes pending profile changes for review', () => {
  assert.match(source, /row\.complianceReviewStatus === 'pending'/);
  assert.match(source, /reviewData\.complianceReviewStatus === 'pending'/);
  assert.match(source, /pendingProfileChanges/);
  assert.match(source, /Pending Compliance Profile Update/);
  assert.match(source, /Approved/);
  assert.match(source, /Requested/);
  assert.match(source, /vehicleYear: 'Vehicle year'/);
  assert.match(source, /vehicleYear: driver\.vehicleYear/);
});

test('Admin Drivers requires a reason and refreshes after a profile rejection or approval', () => {
  assert.match(source, /A reason is required to reject a profile update/);
  assert.match(source, /reviewProfileUpdate\.mutateAsync/);
  assert.match(source, /getListAdminDriverReviewQueryKey\(\)/);
  assert.match(source, /getGetAdminDriverReviewQueryKey\(id\)/);
});
