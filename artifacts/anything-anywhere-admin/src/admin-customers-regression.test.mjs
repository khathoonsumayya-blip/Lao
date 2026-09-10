import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/admin/admin-customers.tsx', import.meta.url), 'utf8');

test('Admin Customers uses required hooks', () => {
  assert.match(source, /useListAdminCustomers\(/);
  assert.match(source, /useGetAdminCustomer\(/);
  assert.match(source, /useUpdateAdminCustomerStatus\(/);
});

test('Admin Customers has loading and error states', () => {
  assert.match(source, /isLoading/);
  assert.match(source, /isError/);
  assert.match(source, /Loading customers\.\.\./);
});

test('Admin Customers has suspension functionality', () => {
  assert.match(source, /Suspend Account/);
  assert.match(source, /Reactivate Account/);
});

test('Admin Customers uses server-side search params with debouncing', () => {
  assert.match(source, /useListAdminCustomers\(\s*\{ search: debouncedQuery \|\| undefined \}/);
  assert.match(source, /setTimeout\(/);
  assert.match(source, /setDebouncedQuery\(searchQuery\)/);
});
