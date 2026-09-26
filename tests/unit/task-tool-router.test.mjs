import assert from 'node:assert/strict';
import test from 'node:test';

import { selectToolSchemasForTurn } from '../../scripts/core/task-tool-router.js';

const ALL_TOOL_NAMES = [
  'create_document',
  'read_document',
  'update_document',
  'delete_document',
  'list_documents',
  'search_documents',
  'document_copy',
  'document_move',
  'search_assets',
  'browse_folders',
  'inspect_document_schema',
  'list_document_schemas',
  'execute_macro',
  'manage_task',
  'run_javascript',
  'read_tool_output',
  'set_document_ownership',
  'end_loop',
];

const schemas = ALL_TOOL_NAMES.map(name => ({
  type: 'function',
  function: { name, parameters: { type: 'object' } },
}));

function namesFor(prompt) {
  return selectToolSchemasForTurn([{ role: 'user', content: prompt }], schemas).map(
    schema => schema.function.name
  );
}

test('research prompt exposes only research/base tools', () => {
  assert.deepEqual(
    namesFor('Search my available documents and compendiums for Goblin and tell me which sources contain it.'),
    ['read_document', 'list_documents', 'search_documents', 'read_tool_output', 'end_loop']
  );
});

test('document plus portrait request composes research and asset tools', () => {
  assert.deepEqual(
    namesFor(
      'Find the Goblin Warrior from the D&D Monster Manual and find an appropriate goblin token or portrait for it. Do not modify anything.'
    ),
    [
      'read_document',
      'list_documents',
      'search_documents',
      'search_assets',
      'browse_folders',
      'read_tool_output',
      'end_loop',
    ]
  );
});

test('authoring request adds structured authoring tools without unrelated capabilities', () => {
  const names = namesFor('Create a goblin warrior named Grunk with 15 HP and a rusty shortsword.');
  for (const expected of [
    'search_documents',
    'read_document',
    'create_document',
    'update_document',
    'inspect_document_schema',
    'list_document_schemas',
    'manage_task',
    'end_loop',
  ]) {
    assert.ok(names.includes(expected), `expected ${expected}`);
  }
  assert.ok(!names.includes('run_javascript'));
  assert.ok(!names.includes('search_assets'));
  assert.ok(!names.includes('delete_document'));
});

test('explicit JavaScript request adds automation tools', () => {
  const names = namesFor('Run this JavaScript in Foundry.');
  assert.ok(names.includes('run_javascript'));
  assert.ok(names.includes('execute_macro'));
});

test('administrative request adds admin tools', () => {
  const names = namesFor('Move this Actor to another compendium.');
  assert.ok(names.includes('document_move'));
  assert.ok(names.includes('document_copy'));
  assert.ok(names.includes('delete_document'));
  assert.ok(names.includes('set_document_ownership'));
});
