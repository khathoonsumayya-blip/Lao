import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('./pages/auth-pages.tsx', import.meta.url), 'utf8');

test('unauthenticated Customer session checks do not poll or refetch over public auth forms', () => {
  assert.match(appSource, /refetchInterval:\s*\(query\)\s*=>\s*query\.state\.status === 'success' && query\.state\.data\?\.profile\?\.role === 'customer'\s*\?\s*20_000\s*:\s*false/);
  assert.match(appSource, /refetchOnWindowFocus:\s*\(query\)\s*=>\s*query\.state\.status === 'success' && query\.state\.data\?\.profile\?\.role === 'customer'/);
  assert.match(appSource, /refetchOnReconnect:\s*\(query\)\s*=>\s*query\.state\.status === 'success' && query\.state\.data\?\.profile\?\.role === 'customer'/);
});

test('the public sign-in form remains outside reactive Customer session gates', () => {
  assert.match(appSource, /<Route path="\/sign-in" component=\{SignInPage\} \/>/);
  const signInSource = loginSource.match(/export function SignInPage\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.doesNotMatch(signInSource, /useCustomerSession|session\.isLoading/);
  assert.doesNotMatch(signInSource, /setEmail\(''\)|setPassword\(''\)/);
});

test('Customer login fields are controlled, editable, and preserve secure password behavior', () => {
  assert.match(loginSource, /<input value=\{value\} onChange=\{\(event\) => onChange\(event\.target\.value\)\}/);
  assert.match(loginSource, /const inputType = type === 'password' && passwordVisible \? 'text' : type/);
  assert.match(loginSource, /autoComplete=\{autoComplete \?\? \(type === 'password' \? 'current-password'/);
  assert.doesNotMatch(
    loginSource.match(/function FormField[\s\S]*?\n\}/)?.[0] ?? '',
    /\b(?:disabled|readOnly)\b/,
  );
});

test('Customer login button is enabled only when both controlled credentials are present', () => {
  assert.match(loginSource, /<PrimaryButton disabled=\{pending \|\| !email \|\| !password\}/);
  assert.match(loginSource, /authRequest\('sign-in', \{\s*email,\s*password\s*\}\)/);
});