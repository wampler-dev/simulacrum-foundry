# Reference Index experiment

## Principle

Let mechanical processes do mechanical things.

Foundry remains authoritative. The reference index is a disposable, derived catalog used to resolve names, sources, document types, UUIDs, and associated artwork before an LLM is asked to reason about document content.

## Observed retrieval failure

A local-model trace for:

> Find the Goblin Warrior from the D&D Monster Manual and find an appropriate goblin token or portrait for it.

showed this sequence:

1. The model listed all 82 compendium packs.
2. The result was compacted; the preview included `Monsters (SRD)` but not the requested Monster Manual pack.
3. The model plausibly but incorrectly selected `dnd5e.monsters`.
4. `Goblin Warrior` returned zero results.
5. The model broadened the query to `goblin`.
6. The SRD pack returned valid Goblin/Hobgoblin records from the wrong source.

The document search itself behaved correctly. The failure was source resolution/provenance before search.

## Initial acceptance criterion

Given:
- name: `Goblin Warrior`
- source: `D&D Monster Manual`
- document type: `Actor`

JavaScript must resolve only references whose mechanically recorded provenance matches the requested source. It must not substitute the SRD or another plausible source.

The compact reference should include, when available:
- name
- UUID
- document type/subtype
- pack ID/label
- package ID/title
- portrait image
- prototype-token image

No LLM call is required for this resolution.
