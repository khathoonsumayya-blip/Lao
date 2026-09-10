import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const safety = await readFile(new URL('./pages/safety.tsx', import.meta.url), 'utf8');

test('issue history is loaded and a created driver issue opens its returned identifier', () => {
  assert.match(safety, /useListDriverIssues/);
  assert.match(safety, /onSuccess: \(issue\) => \{[\s\S]*if \(!issue\.id\)[\s\S]*selectIssue\(issue\.id\)/);
  assert.match(safety, /getListDriverIssuesQueryKey/);
  assert.match(safety, /setLocation\(`\/safety\?issue=\$\{encodeURIComponent\(id\)\}`\)/);
  assert.match(safety, /issueIdFromLocation\(location\)/);
  assert.match(safety, /useListDriverIssueConversation\(issueId/);
  assert.match(safety, /enabled: Boolean\(selectedIssue\)/);
});

test('conversation replies use the generated hook with a stable client request identifier', () => {
  assert.match(safety, /useCreateDriverIssueConversationReply/);
  assert.match(safety, /replyClientRequestId \?\? crypto\.randomUUID\(\)/);
  assert.match(safety, /data: \{ body: reply\.trim\(\), clientRequestId \}/);
  assert.match(safety, /createReply\.isPending \|\| reply\.trim\(\)\.length < 2/);
});

test('requester-safe conversation states are rendered with recovery actions', () => {
  assert.match(safety, /entry\.origin \? 'Original report' : isDriver \? 'You' : 'Support'/);
  assert.match(safety, /conversation\.isLoading/);
  assert.match(safety, /conversation\.isError/);
  assert.match(safety, /conversation\.refetch\(\)/);
  assert.match(safety, /issues\.isLoading/);
  assert.match(safety, /issues\.isError/);
  assert.match(safety, /text-issues-empty/);
});