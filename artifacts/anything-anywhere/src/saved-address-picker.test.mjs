import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/customer-pages.tsx', import.meta.url), 'utf8');

test('saved-address selection explicitly closes its controlled mobile drawer', () => {
  assert.match(source, /<Drawer open=\{open\} onOpenChange=\{setOpen\}>/);
  assert.match(source, /onClick=\{\(\) => \{\s*onSelect\(address\);\s*setOpen\(false\);\s*\}\}/);
});

test('the empty saved-address picker routes customers to their profile', () => {
  assert.match(source, /<Link href="\/profile"[^>]*>Add Address<\/Link>/);
  assert.doesNotMatch(source, /<Link href="\/account"[^>]*>Add Address<\/Link>/);
});