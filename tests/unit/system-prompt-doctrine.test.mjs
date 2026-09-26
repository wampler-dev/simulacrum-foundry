import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const messages = JSON.parse(
  readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8')
);
const standard = messages.SIMULACRUM.SystemPrompt.Standard;

test('read-only doctrine prioritizes resolve_reference and avoids schema discovery', () => {
  assert.match(standard.StrategicProtocol, /READ-ONLY \/ INFORMATIONAL/);
  assert.match(standard.StrategicProtocol, /use resolve_reference first/i);
  assert.match(
    standard.StrategicProtocol,
    /Do not inspect document schemas merely to identify, locate, read, or discuss existing content/i
  );
  assert.match(standard.StrategicProtocol, /Do not use manage_task for a simple read-only request/i);
});

test('mutation doctrine retains read-before-write and verification requirements', () => {
  assert.match(standard.CriticalRules, /NEVER create, update, or delete.*first read/i);
  assert.match(standard.CriticalRules, /verify modifications/i);
  assert.match(standard.StrategicProtocol, /AUTHORING \/ MUTATION/);
  assert.match(standard.StrategicProtocol, /Read every existing document before modifying it/i);
});

test('tool doctrine forbids unrelated tool calls for simple retrieval', () => {
  assert.match(standard.ToolOperatives, /Do not call a tool merely because it is available/i);
  assert.match(
    standard.ToolOperatives,
    /Do not use list_document_schemas or inspect_document_schema unless document structure is actually required/i
  );
  assert.match(
    standard.ToolOperatives,
    /Do not use ownership, creation, update, deletion, macro, or JavaScript tools unless the user's request requires them/i
  );
});

test('loop doctrine permits completion instead of manufacturing another action', () => {
  assert.match(standard.LoopTermination, /When the task is complete, call end_loop/i);
  assert.match(standard.LoopTermination, /Do not invent unrelated work merely to remain in the loop/i);
});
