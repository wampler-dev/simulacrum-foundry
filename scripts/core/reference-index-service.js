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

  const candidateTokens = candidate.split(' ');
  const queryTokens = query.split(' ');
  const tokenMatch = queryTokens.every(token => candidateTokens.includes(token));
  if (!tokenMatch) return 0;

  if (candidate.startsWith(query)) return 70;
  return 50;
}

export class ReferenceIndexService {
  constructor() {
    this.records = [];
    this.built = false;
    this.lastBuildTime = null;
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
    this.lastBuildTime = new Date();
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

  /**
   * Return a compact status summary for diagnostics and UI integration.
   * @returns {{built:boolean,count:number,lastBuildTime:string|null,sources:number}}
   */
  getStatus() {
    return {
      built: this.built,
      count: this.records.length,
      lastBuildTime: this.lastBuildTime?.toISOString?.() ?? null,
      sources: new Set(this.records.map(record => record.packageId).filter(Boolean)).size,
    };
  }

  /**
   * Search references without forcing a source choice.
   * @param {{query:string, documentType?:string, limit?:number}} options
   * @returns {Array<object>} ranked references
   */
  search({ query, documentType, limit = 50 }) {
    return this.resolve({ name: query, documentType, limit });
  }

  /**
   * Group search results by authoritative package provenance.
   * @param {{query:string, documentType?:string, limit?:number}} options
   * @returns {Array<object>} source groups with compact matches
   */
  groupBySource({ query, documentType, limit = 200 }) {
    const matches = this.search({ query, documentType, limit });
    const groups = new Map();

    for (const match of matches) {
      const key = match.packageId || match.packageTitle || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          packageId: match.packageId,
          packageTitle: match.packageTitle,
          matches: [],
        });
      }
      groups.get(key).matches.push(match);
    }

    return [...groups.values()].sort((a, b) =>
      String(a.packageTitle).localeCompare(String(b.packageTitle))
    );
  }

  /**
   * Detect installed package/source names mentioned in natural user text.
   * Longest/highest-confidence source matches are returned first.
   * @param {string} text
   * @returns {Array<object>} detected installed sources
   */
  detectSources(text) {
    const normalizedText = normalizeSource(text);
    const sources = new Map();

    for (const record of this.records) {
      const key = record.packageId || record.packageTitle;
      if (!key || sources.has(key)) continue;

      const aliases = [
        normalizeSource(record.packageTitle),
        normalizeSource(record.packageId),
      ].filter(Boolean);

      const score = Math.max(
        ...aliases.map(alias => this._scoreSourceInText(normalizedText, alias))
      );
      if (!score) continue;

      sources.set(key, {
        packageId: record.packageId,
        packageTitle: record.packageTitle,
        score,
      });
    }

    return [...sources.values()].sort(
      (a, b) => b.score - a.score || a.packageTitle.localeCompare(b.packageTitle)
    );
  }

  /**
   * Resolve a natural phrase by first detecting an installed source and then
   * removing that source phrase before reference-name matching.
   * @param {{text:string, documentType?:string, limit?:number}} options
   * @returns {{source: object|null, query: string, matches: Array<object>}}
   */
  resolveText({ text, documentType, limit = 10 }) {
    const sources = this.detectSources(text);
    const source = sources[0] ?? null;
    let query = normalizeSource(text);

    if (source) {
      const aliases = [
        normalizeSource(source.packageTitle),
        normalizeSource(source.packageId),
      ].filter(Boolean);
      for (const alias of aliases.sort((a, b) => b.length - a.length)) {
        query = query.replace(alias, ' ').replace(/\s+/g, ' ').trim();
      }
    }

    query = query
      .replace(/\b(find|locate|identify|show|tell|about|from|the|an|a|in|of)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const matches = this.resolve({
      name: query,
      source: source?.packageTitle,
      documentType,
      limit,
    });

    return { source, query, matches };
  }

  _scoreSourceInText(text, source) {
    if (!text || !source) return 0;
    if (text === source) return 1000 + source.length;
    if (text.includes(source)) return 500 + source.length;

    const sourceTokens = source.split(' ');
    const textTokens = new Set(text.split(' '));
    if (sourceTokens.length < 2) return 0;
    if (sourceTokens.every(token => textTokens.has(token))) return 200 + source.length;
    return 0;
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
