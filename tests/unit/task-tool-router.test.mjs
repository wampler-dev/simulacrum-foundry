import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectToolNamesForTurn,
  selectToolSchemasForTurn,
} from '../../scripts/core/task-tool-router.js';

test('read-only Goblin benchmark exposes only retrieval capabilities', () => {
  const names = selectToolNamesForTurn(
    'Find the Goblin Warrior from the D&D Monster Manual and find an appropriate goblin token or portrait for it. Do not modify anything.'
  );

  assert.deepEqual(names, [
    'resolve_reference',
    'read_document',
    'search_documents',
    'search_assets',
    'browse_folders',
    'read_tool_output',
    'end_loop',
  ]);
});

test('list_document_schemas is never exposed by task router', () => {
  const prompts = [
    'Find a goblin',
    'Create an Actor',
    'Update this Item',
    'List all compendium documents',
    'Set ownership permissions on this Actor',
  ];

  for (const prompt of prompts) {
    assert.equal(selectToolNamesForTurn(prompt).includes('list_document_schemas'), false);
  }
});

test('authoring receives schema inspection but not schema enumeration', () => {
  const names = selectToolNamesForTurn('Create a new NPC Actor named Grunk');
  assert.equal(names.includes('create_document'), true);
  assert.equal(names.includes('update_document'), true);
  assert.equal(names.includes('inspect_document_schema'), true);
  assert.equal(names.includes('manage_task'), true);
  assert.equal(names.includes('list_document_schemas'), false);
});

test('ownership tool appears only for ownership or permission intent', () => {
  assert.equal(
    selectToolNamesForTurn('Find the Goblin Warrior').includes('set_document_ownership'),
    false
  );
  assert.equal(
    selectToolNamesForTurn('Set ownership permissions for this Actor').includes(
      'set_document_ownership'
    ),
    true
  );
});

test('schema filtering preserves registry order while removing denied tools', () => {
  const schemas = [
    'create_document',
    'read_document',
    'list_document_schemas',
    'resolve_reference',
    'search_documents',
    'end_loop',
  ].map(name => ({ type: 'function', function: { name } }));

  const filtered = selectToolSchemasForTurn('Find Goblin Warrior. Do not modify anything.', schemas);
  assert.deepEqual(
    filtered.map(schema => schema.function.name),
    ['read_document', 'resolve_reference', 'search_documents', 'end_loop']
  );
});
