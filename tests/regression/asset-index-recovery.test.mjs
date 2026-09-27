import assert from 'node:assert/strict';
import test from 'node:test';

const { assetIndexService } = await import('../../scripts/core/asset-index-service.js');

function fakeDB(initial = {}) {
  const meta = new Map(Object.entries(initial));
  const db = {
    meta,
    transaction(names) {
      const tx = { oncomplete: null, onerror: null };
      let counts = 0;
      const counted = request => queueMicrotask(() => {
        request.onsuccess?.();
        counts++;
        if (counts === 2) tx.oncomplete?.();
      });
      const stores = {
        meta: {
          get(key) {
            const request = { result: meta.has(key) ? { value: meta.get(key) } : undefined };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put(record) { meta.set(record.key, record.value); queueMicrotask(() => tx.oncomplete?.()); },
          delete(key) { meta.delete(key); queueMicrotask(() => tx.oncomplete?.()); },
        },
        files: { count: () => {
          const request = { result: 5 };
          counted(request);
          return request;
        }, clear: () => queueMicrotask(() => tx.oncomplete?.()) },
        folders: { count: () => {
          const request = { result: 2 };
          counted(request);
          return request;
        }, clear: () => queueMicrotask(() => tx.oncomplete?.()) },
      };
      tx.objectStore = name => stores[name];
      return tx;
    },
  };
  return db;
}

test('reload rejects an interrupted index with an old completion flag but no timestamp', async t => {
  const oldDB = assetIndexService.db;
  const oldTime = assetIndexService.lastIndexTime;
  t.after(() => { assetIndexService.db = oldDB; assetIndexService.lastIndexTime = oldTime; });
  assetIndexService.db = fakeDB({ hasEverIndexed: true });
  assetIndexService.lastIndexTime = null;
  assert.equal(await assetIndexService._checkExistingIndex(), false);
  assert.equal(assetIndexService.lastIndexTime, null);
});

test('rebuild invalidates cache before writes and marks completion after timestamp', async t => {
  const oldDB = assetIndexService.db;
  t.after(() => { assetIndexService.db = oldDB; });
  assetIndexService.db = fakeDB({ hasEverIndexed: true, lastIndexTime: Date.now() - 1000 });
  await assetIndexService._clearStores();
  assert.equal(assetIndexService.db.meta.has('hasEverIndexed'), false);
  assert.equal(assetIndexService.db.meta.has('lastIndexTime'), false);
  assert.equal(await assetIndexService._checkExistingIndex(), false);
  const completed = new Date();
  await assetIndexService._storeTimestamp(completed);
  assert.equal(assetIndexService.db.meta.get('lastIndexTime'), completed.getTime());
  assert.equal(assetIndexService.db.meta.get('hasEverIndexed'), true);
});

test('completed cache restores counts and timestamp', async t => {
  const oldDB = assetIndexService.db;
  const oldTime = assetIndexService.lastIndexTime;
  const oldFiles = assetIndexService._fileCount;
  const oldFolders = assetIndexService._folderCount;
  t.after(() => {
    assetIndexService.db = oldDB;
    assetIndexService.lastIndexTime = oldTime;
    assetIndexService._fileCount = oldFiles;
    assetIndexService._folderCount = oldFolders;
  });
  const stamp = Date.now();
  assetIndexService.db = fakeDB({ hasEverIndexed: true, lastIndexTime: stamp });
  assert.equal(await assetIndexService._checkExistingIndex(), true);
  assert.equal(assetIndexService.lastIndexTime.getTime(), stamp);
  assert.equal(assetIndexService._fileCount, 5);
  assert.equal(assetIndexService._folderCount, 2);
});
