import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../scripts/core/conversation-engine.js', import.meta.url),
  'utf8'
);

test('conversation engine pre-resolves read-only named references', () => {
  assert.match(source, /_buildResolvedReadOnlyContext/);
  assert.match(source, /referenceIndexService\.resolveTextCompact/);
  assert.match(source, /RESOLVED FOUNDRY REFERENCE CONTEXT/);
});

test('pre-resolved read-only first completion suppresses model tools', () => {
  assert.match(source, /tools: resolvedContext .* null .* turnTools/);
});

test('mutation requests bypass read-only pre-resolution path', () => {
  assert.match(source, /_isMutationRequest/);
  assert.match(source, /create\|update\|modify\|change\|edit\|delete/);
  assert.match(source, /if \(!text \|\| this\._isMutationRequest\(text\)\) return null/);
});


test('conversation engine carries turnTools through initial response and tool loop', () => {
  assert.match(source, /const turnTools = selectToolSchemasForTurn/);
  assert.match(source, /tools: resolvedContext \? null : turnTools/);
  assert.match(source, /const tools = turnTools/);
});
