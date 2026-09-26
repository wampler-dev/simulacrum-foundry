import assert from 'node:assert/strict';
import test from 'node:test';

import { ReferenceIndexService } from '../../scripts/core/reference-index-service.js';

function record(overrides = {}) {
  const base = {
    name: 'Goblin Warrior',
    normalizedName: 'goblin warrior',
    uuid: 'Compendium.dnd-monster-manual.actors.Actor.mmGoblinWarrior',
    documentType: 'Actor',
    normalizedDocumentType: 'actor',
    subtype: 'npc',
    packId: 'dnd-monster-manual.actors',
    normalizedPackId: 'dnd monster manual actors',
    packLabel: 'Monsters',
    normalizedPackLabel: 'monsters',
    packageId: 'dnd-monster-manual',
    normalizedPackageId: 'dnd monster manual',
    packageTitle: 'D&D Monster Manual',
    normalizedPackageTitle: 'd d monster manual',
    img: 'modules/dnd-monster-manual/assets/portraits/goblin-warrior.webp',
    tokenImg: 'modules/dnd-monster-manual/assets/tokens/goblin-warrior.webp',
  };
  return { ...base, ...overrides };
}

test('exact name + explicit source + type resolves the requested Monster Manual actor', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record(),
    record({
      uuid: 'Compendium.dnd5e.actors24.Actor.goblinWarrior',
      packId: 'dnd5e.actors24',
      normalizedPackId: 'dnd5e actors24',
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];

  const results = service.resolve({
    name: 'Goblin Warrior',
    source: 'D&D Monster Manual',
    documentType: 'Actor',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].packId, 'dnd-monster-manual.actors');
  assert.equal(results[0].packageTitle, 'D&D Monster Manual');
  assert.equal(
    results[0].img,
    'modules/dnd-monster-manual/assets/portraits/goblin-warrior.webp'
  );
});

test('explicit source constraint prevents plausible SRD substitution', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({
      name: 'Goblin',
      normalizedName: 'goblin',
      uuid: 'Compendium.dnd5e.monsters.Actor.goblin',
      packId: 'dnd5e.monsters',
      normalizedPackId: 'dnd5e monsters',
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];

  const results = service.resolve({
    name: 'Goblin',
    source: 'D&D Monster Manual',
    documentType: 'Actor',
  });

  assert.deepEqual(results, []);
});

test('without a source constraint, exact-name alternatives remain available', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record(),
    record({
      uuid: 'Compendium.other.actors.Actor.goblinWarrior',
      packId: 'other.actors',
      normalizedPackId: 'other actors',
      packageId: 'other',
      normalizedPackageId: 'other',
      packageTitle: 'Other Bestiary',
      normalizedPackageTitle: 'other bestiary',
    }),
  ];

  const results = service.resolve({ name: 'Goblin Warrior', documentType: 'Actor' });
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Goblin Warrior');
  assert.equal(results[1].name, 'Goblin Warrior');
});

test('document type is a hard constraint when supplied', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({
      documentType: 'Item',
      normalizedDocumentType: 'item',
      uuid: 'Compendium.example.items.Item.goblinWarrior',
    }),
  ];

  assert.deepEqual(
    service.resolve({
      name: 'Goblin Warrior',
      source: 'D&D Monster Manual',
      documentType: 'Actor',
    }),
    []
  );
});


test('D&D shorthand resolves Dungeons & Dragons package title and package id', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({
      packageTitle: 'Dungeons & Dragons Monster Manual',
      normalizedPackageTitle: 'dungeons and dragons monster manual',
    }),
  ];

  const results = service.resolve({
    name: 'Goblin Warrior',
    source: 'D&D Monster Manual',
    documentType: 'Actor',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].packId, 'dnd-monster-manual.actors');
});


test('specific Goblin Warrior query does not match Hobgoblin Warrior', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record(),
    record({
      name: 'Hobgoblin Warrior',
      normalizedName: 'hobgoblin warrior',
      uuid: 'Compendium.dnd-monster-manual.actors.Actor.mmHobgoblinWarrior',
      img: 'modules/dnd-monster-manual/assets/portraits/hobgoblin-warrior.webp',
      tokenImg: 'modules/dnd-monster-manual/assets/tokens/hobgoblin-warrior.webp',
    }),
  ];

  const results = service.resolve({
    name: 'Goblin Warrior',
    source: 'D&D Monster Manual',
    documentType: 'Actor',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].name, 'Goblin Warrior');
});


test('groupBySource preserves provenance for broad Goblin searches', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({ name: 'Goblin', normalizedName: 'goblin' }),
    record({
      name: 'Goblin Boss',
      normalizedName: 'goblin boss',
      uuid: 'Compendium.dnd-monster-manual.actors.Actor.goblinBoss',
    }),
    record({
      name: 'Goblin',
      normalizedName: 'goblin',
      uuid: 'Compendium.dnd5e.monsters.Actor.goblin',
      packId: 'dnd5e.monsters',
      normalizedPackId: 'dnd5e monsters',
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];

  const groups = service.groupBySource({ query: 'Goblin', documentType: 'Actor' });
  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map(group => group.packageId).sort(),
    ['dnd-monster-manual', 'dnd5e'].sort()
  );
});

test('detectSources recognizes installed D&D Monster Manual in natural text', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({
      packageTitle: 'Dungeons & Dragons Monster Manual',
      normalizedPackageTitle: 'dungeons and dragons monster manual',
    }),
    record({
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];

  const sources = service.detectSources(
    'Find the Goblin Warrior from the D&D Monster Manual'
  );

  assert.equal(sources[0].packageId, 'dnd-monster-manual');
});

test('resolveText mechanically resolves natural source-constrained request', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({
      packageTitle: 'Dungeons & Dragons Monster Manual',
      normalizedPackageTitle: 'dungeons and dragons monster manual',
    }),
    record({
      uuid: 'Compendium.dnd5e.actors24.Actor.goblinWarrior',
      packId: 'dnd5e.actors24',
      normalizedPackId: 'dnd5e actors24',
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];

  const result = service.resolveText({
    text: 'Find the Goblin Warrior from the D&D Monster Manual',
    documentType: 'Actor',
  });

  assert.equal(result.source.packageId, 'dnd-monster-manual');
  assert.equal(result.query, 'goblin warrior');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].packId, 'dnd-monster-manual.actors');
});

test('no-match source constraint remains empty instead of substituting another source', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record({
      name: 'Goblin',
      normalizedName: 'goblin',
      uuid: 'Compendium.dnd5e.monsters.Actor.goblin',
      packId: 'dnd5e.monsters',
      normalizedPackId: 'dnd5e monsters',
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];

  assert.deepEqual(
    service.resolve({
      name: 'Goblin Warrior',
      source: 'D&D Monster Manual',
      documentType: 'Actor',
    }),
    []
  );
});


test('getStatus reports a compact deterministic index summary', () => {
  const service = new ReferenceIndexService();
  service.records = [
    record(),
    record({
      packageId: 'dnd5e',
      normalizedPackageId: 'dnd5e',
      packageTitle: 'D&D 5e',
      normalizedPackageTitle: 'd d 5e',
    }),
  ];
  service.built = true;
  service.lastBuildTime = new Date('2026-09-26T12:00:00Z');

  assert.deepEqual(service.getStatus(), {
    built: true,
    count: 2,
    lastBuildTime: '2026-09-26T12:00:00.000Z',
    sources: 2,
  });
});
