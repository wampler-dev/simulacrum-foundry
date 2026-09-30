import test from 'node:test';
import assert from 'node:assert/strict';

import { getTurnToolNames } from '../../scripts/core/turn-capabilities.js';

function toolsFor(content) {
  return getTurnToolNames([{ role: 'user', content }]);
}

test('routes explicit JournalEntry creation to create_document', () => {
  const tools = toolsFor(
    'Create exactly one world JournalEntry named Simulacrum Acceptance I 2026-09-29 using only the name field.'
  );
  assert.equal(tools.has('create_document'), true);
  assert.equal(tools.has('update_document'), false);
  assert.equal(tools.has('set_document_ownership'), false);
  assert.equal(tools.has('run_javascript'), false);
});

test('routes explicit JournalEntry update without granting unrelated mutation tools', () => {
  const tools = toolsFor(
    'Update the world JournalEntry JournalEntry.pbsoGoblinAmbush. Preserve its title and pages.'
  );
  assert.equal(tools.has('update_document'), true);
  assert.equal(tools.has('create_document'), false);
  assert.equal(tools.has('set_document_ownership'), false);
  assert.equal(tools.has('run_javascript'), false);
});

test('read-only JournalEntry request remains read-only', () => {
  const tools = toolsFor(
    'Read the world JournalEntry JournalEntry.pbsoGoblinAmbush. Do not modify it.'
  );
  assert.equal(tools.has('create_document'), false);
  assert.equal(tools.has('update_document'), false);
  assert.equal(tools.has('delete_document'), false);
  assert.equal(tools.has('set_document_ownership'), false);
  assert.equal(tools.has('run_javascript'), false);
});
