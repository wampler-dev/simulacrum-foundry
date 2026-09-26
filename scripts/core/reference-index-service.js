/**
 * Reference Index Service
 *
 * Builds a lightweight, derived catalog of Foundry world documents and
 * compendium entries. Foundry remains authoritative; this service stores only
 * enough metadata to resolve a user's reference deterministically.
 */

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSource(value) {
  const canonical = String(value ?? '')
    .replace(/dungeons\s*(?:&|and)\s*dragons/gi, 'dnd')
    .replace(/d\s*&\s*d/gi, 'dnd');
  return normalize(canonical);
}

function scoreField(candidate, query) {
  if (!query) return 0;
  if (candidate === query) return 100;
  if (candidate.startsWith(query)) return 70;
  if (candidate.includes(query)) return 50;
  return 0;
}

export class ReferenceIndexService {
  constructor() {
    this.records = [];
    this.built = false;
  }

  /**
   * Rebuild the derived reference catalog from current Foundry collections.
   */
  async rebuild() {
    const records = [];

    for (const pack of game.packs ?? []) {
      const source = this._getPackSource(pack);
      const index = await pack.getIndex({
        fields: ['img', 'type', 'prototypeToken.texture.src'],
      });

      for (const entry of index) {
        records.push(this._recordFromCompendiumEntry(pack, entry, source));
      }
    }

    this.records = records;
    this.built = true;
    return records.length;
  }

  /**
   * Resolve references using deterministic name/source/type ranking.
   * @param {{name:string, source?:string, documentType?:string, limit?:number}} query
   * @returns {Array<object>} ranked compact reference records
   */
  resolve({ name, source, documentType, limit = 10 }) {
    const normalizedName = normalize(name);
    const normalizedSource = normalizeSource(source);
    const normalizedType = normalize(documentType);

    return this.records
      .map(record => ({ record, score: this._score(record, normalizedName, normalizedSource, normalizedType) }))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name))
      .slice(0, limit)
      .map(({ record, score }) => ({ ...record, score }));
  }

  _score(record, name, source, documentType) {
    const nameScore = scoreField(record.normalizedName, name);
    if (!nameScore) return 0;

    let score = nameScore * 10;

    if (documentType) {
      if (record.normalizedDocumentType !== documentType) return 0;
      score += 200;
    }

    if (source) {
      const sourceScore = Math.max(
        scoreField(normalizeSource(record.packageTitle), source),
        scoreField(normalizeSource(record.packageId), source),
        scoreField(normalizeSource(record.packLabel), source),
        scoreField(normalizeSource(record.packId), source)
      );
      if (!sourceScore) return 0;
      score += sourceScore * 5;
    }

    return score;
  }

  _getPackSource(pack) {
    const packageId =
      pack.metadata?.packageName ??
      pack.metadata?.package ??
      pack.metadata?.packageId ??
      pack.metadata?.packageName ??
      '';

    const pkg =
      game.modules?.get?.(packageId) ??
      (game.system?.id === packageId ? game.system : null) ??
      (game.world?.id === packageId ? game.world : null);

    const metadataTitle =
      pack.metadata?.packageTitle ??
      pack.metadata?.packageLabel ??
      pack.metadata?.packageName ??
      '';

    return {
      packageId,
      packageTitle: pkg?.title ?? metadataTitle ?? packageId,
    };
  }

  _recordFromCompendiumEntry(pack, entry, source) {
    const id = entry._id ?? entry.id;
    const documentType = pack.documentName ?? pack.metadata?.type ?? '';
    const packId = pack.collection;
    const name = entry.name ?? '';
    const img = entry.img ?? null;
    const tokenImg = entry.prototypeToken?.texture?.src ?? null;

    return {
      name,
      normalizedName: normalize(name),
      uuid: `Compendium.${packId}.${documentType}.${id}`,
      documentType,
      normalizedDocumentType: normalize(documentType),
      subtype: entry.type ?? null,
      packId,
      normalizedPackId: normalize(packId),
      packLabel: pack.metadata?.label ?? pack.title ?? packId,
      normalizedPackLabel: normalize(pack.metadata?.label ?? pack.title ?? packId),
      packageId: source.packageId,
      normalizedPackageId: normalize(source.packageId),
      packageTitle: source.packageTitle,
      normalizedPackageTitle: normalize(source.packageTitle),
      img,
      tokenImg,
    };
  }
}

export const referenceIndexService = new ReferenceIndexService();
