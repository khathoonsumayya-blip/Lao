import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REWARDS_PAGE_PATH = join(process.cwd(), 'src/pages/admin/admin-rewards.tsx');
const APP_PATH = join(process.cwd(), 'src/App.tsx');
const LAYOUT_PATH = join(process.cwd(), 'src/pages/admin/admin-layout.tsx');

test('Admin Rewards page exists and uses all live hooks', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /useListAdminDriverPerformance\(/, 'Uses useListAdminDriverPerformance');
  assert.match(source, /useGetAdminDriverPerformance\(/, 'Uses useGetAdminDriverPerformance');
  assert.match(source, /useListAdminDriverBonuses\(/, 'Uses useListAdminDriverBonuses');
  assert.match(source, /useGetAdminDriverBonusSummary\(/, 'Uses useGetAdminDriverBonusSummary');
  assert.match(source, /useGetAdminDriverBonus\(/, 'Uses useGetAdminDriverBonus');
  assert.match(source, /useCreateAdminDriverBonus\(/, 'Uses useCreateAdminDriverBonus');
  assert.match(source, /useUpdateAdminDriverBonusStatus\(/, 'Uses useUpdateAdminDriverBonusStatus');
});

test('Admin Rewards uses the dedicated Admin session proof for mutation controls', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /getQueryData<\{ profile\?: \{ role\?: string \} \}>\(\['admin-auth-session'\]\)/);
  assert.doesNotMatch(source, /useGetAuthSession/);
});

test('App routing includes /rewards', () => {
  const source = readFileSync(APP_PATH, 'utf-8');
  assert.match(source, /<Route path="\/rewards" component={AdminRewards} \/>/, 'Has /rewards route');
});

test('Admin layout nav includes Rewards', () => {
  const source = readFileSync(LAYOUT_PATH, 'utf-8');
  assert.match(source, /\['\/rewards', 'Rewards', Award\]/, 'Nav array has rewards');
});

test('Idempotency keys are implemented on mutations', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /'Idempotency-Key': idempotencyKey/, 'Sends Idempotency-Key header');
  assert.match(source, /setIdempotencyKey\(crypto.randomUUID\(\)\)/, 'Resets idempotency key');
});

test('Lifecycle semantic checks and labels', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /status === 'pending'/, 'Checks pending status');
  assert.match(source, /status === 'approved'/, 'Checks approved status');
  assert.match(source, /status === 'paid'/, 'Checks paid status');
  assert.match(source, /action === 'reverse'/, 'Handles reverse action');
});

test('Pagination is implemented for driver performance', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /setPage\(1\)/, 'Resets page');
  assert.match(source, /page,/, 'Sends page param');
  assert.match(source, /pageSize,/, 'Sends pageSize param');
  assert.match(source, /disabled=\{page === 1 \|\| isLoading \|\| isFetching\}/, 'Disables previous button');
  assert.match(source, /disabled=\{!drivers \|\| drivers\.length < pageSize \|\| isLoading \|\| isFetching\}/, 'Disables next button');
});

test('All Awards rows open one accessible manage dialog only for admins', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /const \[selectedBonusId, setSelectedBonusId\] = useState<string \| null>\(null\)/, 'Keeps the selected award at tab level');
  assert.match(source, /role=\{isAdmin \? 'button' : undefined\}/, 'Makes admin rows discoverable as controls');
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/, 'Supports keyboard activation');
  assert.match(source, /event\.stopPropagation\(\)/, 'Manage button does not also trigger the row');
  assert.match(source, /selectedBonusId && isAdmin &&/, 'Dispatchers cannot open mutation controls');
  assert.match(source, /<ManageBonusDialog bonusId=\{selectedBonusId\}/, 'Uses the real bonus dialog for the selected row');
});

test('Rewards mutations invalidate every affected generated query family', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /getListAdminDriverPerformanceQueryKey\(\)/, 'Invalidates performance list queries');
  assert.match(source, /getGetAdminDriverPerformanceQueryKey\(\)/, 'Invalidates performance detail queries');
  assert.match(source, /getListAdminDriverBonusesQueryKey\(\)/, 'Invalidates award list queries');
  assert.match(source, /getGetAdminDriverBonusSummaryQueryKey\(\)/, 'Invalidates global summary queries');
  assert.match(source, /getGetAdminDriverBonusQueryKey\(createdBonus\.id\)/, 'Invalidates created bonus detail');
  assert.match(source, /getGetAdminDriverBonusQueryKey\(bonusId\)/, 'Invalidates updated bonus detail');
});

test('Summary refreshes on focus and performance table explains horizontal scrolling', () => {
  const source = readFileSync(REWARDS_PAGE_PATH, 'utf-8');
  assert.match(source, /refetchOnWindowFocus: true/, 'Refreshes stale totals when returning to the page');
  assert.doesNotMatch(source, /refetchInterval/, 'Does not aggressively poll the summary');
  assert.match(source, /Unable to load bonus summary/, 'Shows a visible summary error state');
  assert.match(source, /aria-label="Driver performance table"/, 'Labels the horizontal performance scroller');
  assert.match(source, /Swipe left or right to view all performance columns/, 'Shows the small-screen scrolling hint');
});
