import assert from 'node:assert/strict';
import test from 'node:test';
import { looksLikePendingToolAction } from '../../scripts/utils/pending-action.js';

const schemas = names =>
  names.map(name => ({ type: 'function', function: { name } }));

test('detects narrated resolve action when resolver is available', () => {
  assert.equal(
    looksLikePendingToolAction(
      'Resolving reference to find the Goblin Warrior in the D&D Monster Manual.',
      schemas(['resolve_reference', 'read_document', 'end_loop'])
    ),
    true
  );
});

test('ordinary complete answer is not treated as a pending action', () => {
  assert.equal(
    looksLikePendingToolAction(
      'The Goblin Warrior uses the Monster Manual portrait and token.',
      schemas(['resolve_reference', 'read_document', 'end_loop'])
    ),
    false
  );
});

test('narrated unavailable capability is not retried', () => {
  assert.equal(
    looksLikePendingToolAction(
      'Searching for another token image.',
      schemas(['resolve_reference', 'read_document', 'end_loop'])
    ),
    false
  );
});

test('long prose is not classified as a dangling action', () => {
  const content = 'Resolving reference. ' + 'Complete explanatory prose. '.repeat(30);
  assert.equal(
    looksLikePendingToolAction(content, schemas(['resolve_reference', 'end_loop'])),
    false
  );
});
