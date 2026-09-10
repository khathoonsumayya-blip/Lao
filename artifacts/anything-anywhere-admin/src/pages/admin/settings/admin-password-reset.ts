import { apiUrl } from '@/lib/api-url';

export async function requestAdminPasswordReset(email: string): Promise<void> {
  const response = await fetch(apiUrl('/api/auth/admin/password-reset'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    throw new Error('The Admin password reset request could not be sent.');
  }
}