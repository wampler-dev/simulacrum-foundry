import assert from 'node:assert/strict';
import test from 'node:test';

import { assetIndexService as index } from '../../scripts/core/asset-index-service.js';
import { AssetSearchTool } from '../../scripts/tools/asset-search.js';
import { BrowseFoldersTool } from '../../scripts/tools/browse-folders.js';

function setIndexState(t, changes) {
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, index[key]]));
  t.after(() => Object.assign(index, previous));
  Object.assign(index, changes);
}

test('partial rebuild blocks indexed tools and direct searches', async t => {
  setIndexState(t, {
    db: { transaction() { throw new Error('partial index must not be read'); } },
    _initialIndexComplete: true,
    _initialIndexPromise: null,
    isIndexing: true,
    _fileCount: 8719,
    _folderCount: 509,
  });

  assert.equal(index.isReady(), false);
  assert.match(index.getAvailability().reason, /rebuild in progress/);
  assert.equal((await new AssetSearchTool().execute({ query: 'goblin' })).error.type, 'INDEX_UNAVAILABLE');
  assert.equal((await new BrowseFoldersTool().execute({ action: 'search', path: 'tokens' })).error.type, 'INDEX_UNAVAILABLE');
  await assert.rejects(index.search('goblin'), { code: 'INDEX_UNAVAILABLE' });
  await assert.rejects(index.searchFolders('tokens'), { code: 'INDEX_UNAVAILABLE' });
});

test('a rebuild beginning during a cursor search cannot return partial results', async t => {
  const db = {
    transaction() {
      return {
        objectStore() {
          return {
            openCursor() {
              const request = {};
              queueMicrotask(() => request.onsuccess({
                target: {
                  result: {
                    value: { path: 'modules/example/goblin.webp', filename: 'goblin.webp' },
                    continue() {
                      index.isIndexing = true;
                      queueMicrotask(() => request.onsuccess({ target: { result: null } }));
                    },
                  },
                },
              }));
              return request;
            },
          };
        },
      };
    },
  };
  setIndexState(t, {
    db,
    _initialIndexComplete: true,
    _initialIndexPromise: null,
    isIndexing: false,
    _fileCount: 1,
    _folderCount: 1,
  });

  await assert.rejects(index.search('goblin', 'image'), { code: 'INDEX_UNAVAILABLE' });
  index.isIndexing = false;
  const toolResult = await new AssetSearchTool().execute({ query: 'goblin', type: 'image' });
  assert.equal(toolResult.error.type, 'INDEX_UNAVAILABLE');
  assert.match(toolResult.content, /rebuild in progress/);
});

test('a completed index still returns matching paths', async t => {
  const db = {
    transaction() {
      return {
        objectStore() {
          return {
            openCursor() {
              const request = {};
              queueMicrotask(() => request.onsuccess({
                target: {
                  result: {
                    value: { path: 'modules/example/goblin-warrior.webp', filename: 'goblin-warrior.webp' },
                    continue() {
                      queueMicrotask(() => request.onsuccess({ target: { result: null } }));
                    },
                  },
                },
              }));
              return request;
            },
          };
        },
      };
    },
  };
  setIndexState(t, {
    db,
    _initialIndexComplete: true,
    _initialIndexPromise: null,
    isIndexing: false,
    _fileCount: 1,
    _folderCount: 1,
  });

  assert.deepEqual(await index.search('goblin-warrior', 'image'), ['modules/example/goblin-warrior.webp']);
  const result = await new AssetSearchTool().execute({ query: 'goblin-warrior', type: 'image' });
  assert.match(result.content, /goblin-warrior\.webp/);
  assert.equal(result.error, undefined);
});

test('a cursor failure never returns a partial match list', async t => {
  setIndexState(t, {
    db: {
      transaction() {
        return {
          objectStore() {
            return {
              openCursor() {
                const request = {};
                queueMicrotask(() => request.onerror());
                return request;
              },
            };
          },
        };
      },
    },
    _initialIndexComplete: true,
    _initialIndexPromise: null,
    isIndexing: false,
    _fileCount: 1,
    _folderCount: 1,
  });

  await assert.rejects(index.search('goblin'), /IndexedDB cursor error/);
  const result = await new AssetSearchTool().execute({ query: 'goblin' });
  assert.equal(result.error.type, 'SEARCH_FAILED');
});

test('a stalled rebuild warns once with its current path and phase', t => {
  const warnings = [];
  setIndexState(t, {
    isIndexing: true,
    _lastProgressAt: Date.now() - 121000,
    _stallWarningIssued: false,
    _indexPath: 'data/modules/example',
    _indexPhase: 'browse',
    _fileCount: 8719,
    _folderCount: 509,
    logger: { warn(message) { warnings.push(message); } },
  });

  index._checkStaleness();
  index._checkStaleness();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /data\/modules\/example.*browse.*8719 files/);
  assert.equal(index.getStats().indexPath, 'data/modules/example');
});
