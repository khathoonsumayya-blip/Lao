import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/customer-pages.tsx', import.meta.url), 'utf8');
const operationsSource = await readFile(new URL('./pages/operations-page.tsx', import.meta.url), 'utf8');

test('customer support lists requester-owned tickets and persists selection in the URL', () => {
  assert.match(source, /useListCustomerSupportTickets\(/);
  assert.match(source, /getListCustomerSupportTicketsQueryKey\(\)/);
  assert.match(source, /new URLSearchParams\(search\)\.get\('ticket'\)/);
  assert.match(source, /setLocation\(`\/support\?ticket=\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(source, /sort\(\(a, b\) => new Date\(b\.updatedAt \|\| b\.createdAt\)/);
  assert.match(source, /useListCustomerSupportTicketConversation\(selectedTicket\?\.id \?\? 'missing'/);
  assert.match(source, /useCreateCustomerSupportTicketConversationReply\(\)/);
  assert.match(source, /replyMutation\.mutate\(\{ id: selectedTicket\.id, data: \{ body: reply\.trim\(\) \} \}/);
  assert.match(source, /invalidateQueries\(\{ queryKey: getListCustomerSupportTicketsQueryKey\(\) \}\)/);
});

test('customer support handles history and conversation loading, errors, and empty states', () => {
  assert.match(source, /Loading support history/);
  assert.match(source, /Support history is unavailable/);
  assert.match(source, /No support requests yet\./);
  assert.match(source, /Loading conversation/);
  assert.match(source, /Conversation is unavailable/);
  assert.match(source, /No messages yet\./);
});

test('customer notifications deep-link only customer support tickets', () => {
  assert.match(source, /useListNotifications\(\{ query: \{ queryKey: getListNotificationsQueryKey\(\) \} \}\)/);
  assert.match(source, /notification\.supportSource === 'customer_ticket' && notification\.supportId/);
  assert.match(source, /setLocation\(`\/support\?ticket=\$\{encodeURIComponent\(notification\.supportId\)\}`\)/);
});

test('customer support labels the requester thread as a conversation and reply', () => {
  assert.match(source, />Conversation</);
  assert.match(source, />Reply</);
  assert.doesNotMatch(source, /Internal Discussion|Type an internal note|Add Note/);
});

test('staff support keeps Admin hooks source-scoped and labels replies as requester-visible', () => {
  assert.match(operationsSource, /rawSource === 'customer_ticket' \|\| rawSource === 'driver_issue'/);
  assert.match(operationsSource, /useListAdminSupportTicketComments\(id \|\| 'missing', querySource/);
  assert.match(operationsSource, /addComment\.mutate\(\{ id, source, data: \{ source, body: newComment \} \}/);
  assert.match(operationsSource, /getListAdminSupportTicketCommentsQueryKey\(id, source\)/);
  assert.match(operationsSource, />Conversation</);
  assert.match(operationsSource, />\s*Send Reply\s*</);
  assert.doesNotMatch(operationsSource, /Internal Discussion|Type an internal note|Add Note/);
});