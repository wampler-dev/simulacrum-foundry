import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentAPI } from '../../scripts/core/document-api.js';

test('world creation passes minimal JournalEntry data to Foundry create', async t => {
  const oldConfig = Object.getOwnPropertyDescriptor(globalThis, 'CONFIG');
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  t.after(() => {
    if (oldConfig) Object.defineProperty(globalThis, 'CONFIG', oldConfig);
    else delete globalThis.CONFIG;
    if (oldGame) Object.defineProperty(globalThis, 'game', oldGame);
    else delete globalThis.game;
  });

  const calls = [];
  class JournalEntry {
    static schema = {
      validate() {
        throw new Error('Raw data must be cleaned before schema validation');
      },
    };

    static async create(data, options) {
      calls.push({ data, options });
      return { toObject: () => ({ _id: 'created-journal', ...data }) };
    }
  }
  globalThis.CONFIG = { JournalEntry: { documentClass: JournalEntry } };
  globalThis.game = { user: { isGM: true } };

  const data = { name: 'Simulacrum Acceptance I 2026-09-29' };
  const result = await DocumentAPI.createDocument('JournalEntry', data);
  assert.deepEqual(calls, [{ data, options: { folder: undefined } }]);
  assert.deepEqual(result, { _id: 'created-journal', ...data });
});

test('world creation propagates native validation failure without claiming success', async t => {
  const oldConfig = Object.getOwnPropertyDescriptor(globalThis, 'CONFIG');
  const oldGame = Object.getOwnPropertyDescriptor(globalThis, 'game');
  t.after(() => {
    if (oldConfig) Object.defineProperty(globalThis, 'CONFIG', oldConfig);
    else delete globalThis.CONFIG;
    if (oldGame) Object.defineProperty(globalThis, 'game', oldGame);
    else delete globalThis.game;
  });

  const validationError = new Error('Foundry rejected invalid journal data');
  validationError.name = 'DataModelValidationError';
  let createCalls = 0;
  globalThis.CONFIG = { JournalEntry: { documentClass: {
    async create() {
      createCalls++;
      throw validationError;
    },
  } } };
  globalThis.game = { user: { isGM: true } };

  await assert.rejects(
    DocumentAPI.createDocument('JournalEntry', { name: '' }),
    error => error === validationError
  );
  assert.equal(createCalls, 1);
});
