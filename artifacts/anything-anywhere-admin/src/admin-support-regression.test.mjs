import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./pages/admin/admin-support.tsx', import.meta.url), 'utf8');

const layoutSource = await readFile(new URL('./pages/admin/admin-layout.tsx', import.meta.url), 'utf8');

test('Admin Support distinguishes loading, error, empty, and populated states', () => {
  assert.match(source, /isLoading,\s*isError,\s*refetch/);
  assert.match(source, /Support tickets could not be loaded\./);
  assert.match(source, /No tickets found\./);
  assert.match(source, /filteredTickets\.length === 0/);
});

test('Admin Support renders and opens the fields returned by the live API', () => {
  assert.match(source, /ticket\.category\.replace/);
  assert.match(source, /ticket\.message/);
  assert.match(source, /setSelectedTicketId\(ticket.id\)/);
});

test('Admin Support ticket detail allows status transitions to In Progress and back to Open', () => {
  assert.match(source, /Start Progress/);
  assert.match(source, /Return to Open/);
  assert.match(source, /handleStatusUpdate/);
  assert.match(source, /handleStatusUpdate\('in_progress'\)/);
  assert.match(source, /status: newStatus/);
});

test('Admin Support correctly provides source payload for updates and omits resolution on reopen', () => {
  assert.match(source, /source: ticket\.source/);
  assert.match(source, /data: \{ status: 'open', source: ticket\.source \}/);
});

test('Admin Support assignment loads active agents and handles source-aware update', () => {
  assert.match(source, /useListAdminSupportAgents/);
  assert.match(source, /assignedProfileId: e\.target\.value \|\| undefined/);
  assert.match(source, /Assign to Agent/);
  assert.match(source, /Unassigned/);
});

test('Admin Support conversations use source-aware hooks with duplicate protection and truth-in-labeling', () => {
  assert.match(source, /Reply to the requester/i);
  assert.match(source, /useListAdminSupportTicketComments\(ticket\.id,\s*ticket\.source/);
  assert.match(source, /useCreateAdminSupportTicketComment/);
  assert.match(source, /clientRequestId:\s*crypto\.randomUUID\(\)/);
  assert.match(source, /c\.origin\s*&&/);
});

test('Admin Support desktop empty detail placeholder shares space without compressing list pane', () => {
  assert.match(source, /w-full lg:w-1\/3 xl:w-2\/5/);
});

test('Admin Layout drawer navigation handles viewport overflow safely', () => {
  assert.match(layoutSource, /overflow-y-auto/);
  assert.match(layoutSource, /shrink-0/);
  assert.match(layoutSource, /env\(safe-area-inset-bottom\)/);
});