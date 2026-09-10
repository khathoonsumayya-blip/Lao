import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('./pages/admin/admin-login.tsx', import.meta.url), 'utf8');
const loginCss = await readFile(new URL('./admin.css', import.meta.url), 'utf8');
const adminSessionHookSource = appSource.slice(
  appSource.indexOf('function useAdminSession'),
  appSource.indexOf('const permissionMessage'),
);

test('unauthenticated Admin session checks do not poll or refetch over the login form', () => {
  assert.match(appSource, /const \[publicLoginMounted, setPublicLoginMounted\] = useState\(false\)/);
  assert.match(appSource, /if \(unauthorized\) setPublicLoginMounted\(true\)/);
  assert.match(appSource, /enabled:\s*!publicLoginMounted/);
  assert.match(appSource, /refetchOnMount:\s*false/);
  assert.match(appSource, /retryOnMount:\s*false/);
  assert.match(appSource, /refetchInterval:\s*\(query\)\s*=>\s*query\.state\.status === 'success' && adminRoles\.has\([^)]*role[^)]*\)\s*\?\s*20_000\s*:\s*false/);
  assert.match(appSource, /refetchOnWindowFocus:\s*\(query\)\s*=>\s*query\.state\.status === 'success' && adminRoles\.has/);
  assert.match(appSource, /refetchOnReconnect:\s*\(query\)\s*=>\s*query\.state\.status === 'success' && adminRoles\.has/);
  assert.match(appSource, /if \(publicLoginMounted \|\| unauthorized\) \{\s*return <AdminLogin onSuccess=\{refreshAfterLogin\} \/>/);
  assert.match(appSource, /const refreshed = await session\.refetch\(\)/);
  assert.match(appSource, /setPublicLoginMounted\(false\)/);
});

test('delayed unauthorized session activity cannot replace the mounted login form', () => {
  assert.match(appSource, /const unauthorized = session\.isError && session\.error\.status === 401/);
  assert.match(appSource, /useAdminSession\(publicLoginMounted\)/);
  assert.doesNotMatch(adminSessionHookSource, /refetchOnMount:\s*['"]always['"]/);
  assert.doesNotMatch(appSource, /<AdminLogin[^>]*key=/);
});

test('Admin credentials remain editable and the password remains securely masked', () => {
  const emailInput = loginSource.match(/<input[\s\S]*?id="admin-email"[\s\S]*?\/>/)?.[0] ?? '';
  const passwordInput = loginSource.match(/<input[\s\S]*?id="admin-password"[\s\S]*?\/>/)?.[0] ?? '';

  assert.match(emailInput, /type="email"/);
  assert.match(passwordInput, /type="password"/);
  assert.match(passwordInput, /autoComplete="current-password"/);
  assert.doesNotMatch(emailInput, /\b(?:disabled|readOnly)\b/);
  assert.doesNotMatch(passwordInput, /\b(?:disabled|readOnly)\b/);
  assert.match(loginCss, /\.aa-admin-login-input[\s\S]*?pointer-events:\s*auto/);
});

test('Admin login submits both credentials with dedicated Admin session proof', () => {
  assert.match(loginSource, /new FormData\(event\.currentTarget as HTMLFormElement\)/);
  assert.match(loginSource, /JSON\.stringify\(\{\s*email,\s*password,\s*adminSession:\s*true\s*\}\)/);
});