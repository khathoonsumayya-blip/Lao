import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/admin/admin-deliveries.tsx', import.meta.url), 'utf8');

test('Admin Deliveries uses required hooks', () => {
  assert.match(source, /useListAdminDeliveries\(/);
  assert.match(source, /useListApprovedDrivers\(/);
  assert.match(source, /useAssignDeliveryDriver\(/);
  assert.match(source, /useUpdateAdminDeliveryStatus\(/);
});

test('Admin Deliveries has explicit loading/error feedback', () => {
  assert.match(source, /isLoading/);
  assert.match(source, /isError/);
  assert.match(source, /Loading deliveries\.\.\./);
  assert.match(source, /Failed to load deliveries\./);
  assert.match(source, /No deliveries found in the system\./);
});

test('Admin Deliveries removes provider-controlled status options', () => {
  assert.doesNotMatch(source, /value: 'payment_pending'/);
  assert.doesNotMatch(source, /value: 'paid'/);
  assert.doesNotMatch(source, /value: 'refunded'/);
});

test('Admin Deliveries refreshes deliveries, approved drivers, and summary atomically', () => {
  assert.match(source, /refetch:\s*refetchDeliveries/);
  assert.match(source, /refetch:\s*refetchDrivers/);
  assert.match(source, /useGetAdminDashboard/);
  assert.match(source, /refetch:\s*refetchSummary/);
  assert.match(source, /const handleRefresh = async \(\) =>/);
  assert.match(source, /await Promise\.all\(\[\s*refetchDeliveries\(\),\s*refetchDrivers\(\),\s*refetchSummary\(\),\s*\]\)/s);
  assert.doesNotMatch(source, /onClick=\{\(\) => refetch\(\)\}/);
});

test('Admin Deliveries exposes refresh progress, success, and non-destructive failure feedback', () => {
  assert.match(source, /isRefreshing/);
  assert.match(source, /const refreshLock = useRef\(false\)/);
  assert.match(source, /const refreshButtonRef = useRef<HTMLButtonElement>\(null\)/);
  assert.match(source, /if \(refreshLock\.current\) return/);
  assert.match(source, /refreshLock\.current = true/);
  assert.match(source, /refreshButtonRef\.current\.disabled = true/);
  assert.match(source, /refreshLock\.current = false/);
  assert.match(source, /refreshButtonRef\.current\.disabled = false/);
  assert.match(source, /2_500 - \(Date\.now\(\) - startedAt\)/);
  assert.match(source, /Refreshing\.\.\./);
  assert.match(source, /setLastRefreshed\(new Date\(\)\)/);
  assert.match(source, /Last refreshed/);
  assert.match(source, /role="alert"/);
  assert.match(source, /Refresh failed:/);
  assert.match(source, /const visibleRefreshError = refreshError/);
  assert.match(source, /isDriversError && deliveries/);
  assert.match(source, /isSummaryError && summary/);
});

test('Admin Deliveries requests the latest changed deliveries', () => {
  assert.match(source, /useListAdminDeliveries\([\s\S]*?\{ sort: 'recently_changed' \}/);
  assert.match(source, /getListAdminDeliveriesQueryKey\(\{ sort: 'recently_changed' \}\), retry: false/);
  assert.match(source, /getListApprovedDriversQueryKey\(\), retry: false/);
  assert.match(source, /getGetAdminDashboardQueryKey\(\), retry: false/);
});

test('Admin Deliveries mutation refreshes retain both affected datasets', () => {
  assert.match(source, /await assign\.mutateAsync[\s\S]*?await handleRefresh\(\)/);
  assert.match(source, /await update\.mutateAsync[\s\S]*?await handleRefresh\(\)/);
  assert.match(source, /isError && !deliveries/);
});
