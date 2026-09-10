import assert from 'node:assert/strict';
import test from 'node:test';
import { customerSignInLocation, locationWithPresentationQuery } from './customer-entry-routing.ts';

test('unauthenticated root visits redirect to the stable sign-in route', () => {
  assert.equal(customerSignInLocation(''), '/sign-in');
});

test('unauthenticated root visits preserve the native browser presentation query', () => {
  assert.equal(
    customerSignInLocation('?nativeBrowserPresentationStyle=fullScreen'),
    '/sign-in?nativeBrowserPresentationStyle=fullScreen',
  );
});

test('auth redirects preserve full-screen presentation without carrying unrelated query data', () => {
  assert.equal(
    locationWithPresentationQuery(
      '/sign-in',
      '?token=secret-reset-token&fullScreen=true&nativeBrowserPresentationStyle=fullScreen',
    ),
    '/sign-in?fullScreen=true&nativeBrowserPresentationStyle=fullScreen',
  );
});