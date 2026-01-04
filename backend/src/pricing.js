const fs = require('fs/promises');
const path = require('path');

const SNAPSHOT_KEY = 'site-prep-local-v1';
const DATA_DIR = path.join(__dirname, '..', 'data', 'prices');
const MSU_FILE = path.join(DATA_DIR, 'msu-dollar-lines.txt');
const MDOT_FILE = path.join(DATA_DIR, 'mdot-allitems-mi-siteprep-v4.csv');

const MSU_OPERATION_SPECS = [
  {
    key: 'stalkShredder20Ft',
    label: 'Stalk Shredder 20 Ft',
    searchTokens: ['stalk shredder 20 ft'],
  },
  {
    key: 'rotaryMowerConditioner12Ft',
    label: 'Rotary Mower/Conditioner 12 Ft',
    searchTokens: ['rotary mower/conditioner 12 ft'],
  },
];

const MDOT_ITEM_SPECS = {
  clearingAndGrubbing: { itemId: '2010001', label: 'Clearing', overrideUnit: 'Acr' },
  pavementRemoval: { itemId: '2040050', label: 'Pavt, Rem' },
  concreteRemovalSyd: { itemId: '2040055', label: 'Sidewalk, Rem' },
  concreteRemovalSft: { itemId: '2047010', label: 'Conc Sidewalk, Driveway and Approach, Rem' },
  earthExcavation: { itemId: '2050016', label: 'Excavation, Earth' },
  treeRemoval6to18: { itemId: '2020004', label: 'Tree, Rem, 6 inch to 18 inch' },
  stumpRemoval6to18: { itemId: '2020008', label: 'Stump, Rem, 6 inch to 18 inch' },
};

function makeDataError(message, details = {}) {
  const err = new Error(message);
  err.statusCode = err.statusCode || 500;
  err.details = { ...details, file: details.file || null };
  return err;
}

function normalizeWhitespace(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function toNumber(value) {
  if (value === undefined || value === null) return null;
  const trimmed = typeof value === 'string' ? value.trim() : value;
  if (trimmed === '') return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function ensureQueriesContract(queries) {
  if (!queries || typeof queries.getLatestPricingSnapshot !== 'function' || typeof queries.savePricingSnapshot !== 'function') {
    throw new Error('queries with pricing snapshot helpers is required');
  }
}

async function readTextFile(filePath) {
  const buffer = await fs.readFile(filePath);
  if (buffer.length >= 2) {
    const b0 = buffer[0];
    const b1 = buffer[1];
    if (b0 === 0xff && b1 === 0xfe) {
      return buffer.toString('utf16le');
    }
    if (b0 === 0xfe && b1 === 0xff) {
      const swapped = Buffer.from(buffer);
      swapped.swap16();
      return swapped.toString('utf16le');
    }
  }
  return buffer.toString('utf8');
}

function parseMsuDollarLines(content) {
  const lines = content.split(/\r?\n/);
  const separatorIndex = lines.findIndex((line) => line.trim().startsWith('---'));
  const headerLines = separatorIndex >= 0 ? lines.slice(0, separatorIndex) : lines;
  const dataLines = separatorIndex >= 0 ? lines.slice(separatorIndex + 1) : [];

  const header = {};
  for (const rawLine of headerLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) continue;
    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (key) {
      header[key] = value;
    }
  }

  const parsedLines = [];
  for (const rawLine of dataLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+):\s*(.+)$/);
    if (!match) continue;
    const lineNumber = Number(match[1]);
    const text = match[2].trim();
    const valueMatches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\$/g));
    if (!valueMatches.length) continue;
    const values = valueMatches.map((m) => Number(m[1]));
    const description = normalizeWhitespace(text.replace(/(\d+(?:\.\d+)?)\$/g, ' ').replace(/\$/g, ' '));
    if (!description) continue;
    parsedLines.push({
      lineNumber,
      description,
      normalizedDescription: description.toLowerCase(),
      values,
    });
  }

  return { header, lines: parsedLines };
}

function mapMsuOperations(lines) {
  const rates = {};
  const matches = [];
  const missing = [];

  for (const spec of MSU_OPERATION_SPECS) {
    const hit = lines.find((line) => spec.searchTokens.some((token) => line.normalizedDescription.includes(token)));
    if (!hit) {
      missing.push(spec.label || spec.key);
      continue;
    }

    const usdPerAcre = toNumber(hit.values[0]);
    if (!Number.isFinite(usdPerAcre)) {
      throw makeDataError(`MSU line ${hit.lineNumber} is missing a numeric USD/acre total for ${spec.label}.`, {
        file: path.basename(MSU_FILE),
        lineNumber: hit.lineNumber,
        description: hit.description,
      });
    }

    rates[spec.key] = usdPerAcre;
    matches.push({
      key: spec.key,
      lineNumber: hit.lineNumber,
      description: hit.description,
      usdPerAcre,
      values: hit.values,
    });
  }

  if (missing.length) {
    throw makeDataError(`Missing required MSU operations: ${missing.join(', ')}.`, {
      file: path.basename(MSU_FILE),
      missing,
    });
  }

  return { rates, matches };
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (inQuotes) {
    throw makeDataError('MDOT CSV parsing failed: unmatched quote.', { file: path.basename(MDOT_FILE) });
  }

  values.push(current);
  return values;
}

function parseMdotCsv(content) {
  const lines = content.split(/\r?\n/);
  const filtered = lines.filter((line) => line.length > 0);
  if (!filtered.length) {
    throw makeDataError('MDOT CSV has no rows.', { file: path.basename(MDOT_FILE) });
  }

  const headerCells = parseCsvLine(filtered.shift());
  const header = headerCells.map((cell, idx) => {
    const sanitized = cell.replace(/^\uFEFF/, '').trim();
    return sanitized || `column_${idx}`;
  });

  const records = [];
  for (const line of filtered) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = parseCsvLine(line);
    const record = {};
    header.forEach((column, idx) => {
      record[column] = (cells[idx] || '').trim();
    });
    const hasValue = Object.values(record).some((value) => value !== '');
    if (hasValue) {
      records.push(record);
    }
  }

  return { header, records };
}

function mapMdotItems(records) {
  const byId = new Map();
  for (const record of records) {
    if (record.item_id) {
      byId.set(record.item_id, record);
    }
  }

  const items = {};
  const matches = [];
  const missing = [];

  for (const [key, spec] of Object.entries(MDOT_ITEM_SPECS)) {
    const row = byId.get(spec.itemId);
    if (!row) {
      missing.push({ key, itemId: spec.itemId });
      continue;
    }

    const avgAwardPriceUsd = toNumber(row.avg_award_price_usd);
    if (!Number.isFinite(avgAwardPriceUsd)) {
      throw makeDataError(`MDOT item ${spec.itemId} (${spec.label}) is missing avg_award_price_usd.`, {
        file: path.basename(MDOT_FILE),
        itemId: spec.itemId,
      });
    }

    items[key] = {
      itemId: row.item_id,
      description: row.description,
      unit: spec.overrideUnit || row.unit || null,
      sourceUnit: row.unit || null,
      avgAwardPriceUsd,
      totalQuantity: toNumber(row.total_qty),
      totalDollars: toNumber(row.total_dollars),
    };

    matches.push({
      key,
      itemId: row.item_id,
      description: row.description,
    });
  }

  if (missing.length) {
    const missingSummary = missing.map((m) => `${m.key} (${m.itemId})`).join(', ');
    throw makeDataError(`Missing required MDOT items: ${missingSummary}.`, {
      file: path.basename(MDOT_FILE),
      missing,
    });
  }

  return { items, matches };
}

async function buildPricingSnapshotFromLocalFiles() {
  const [msuContent, mdotContent, msuStats, mdotStats] = await Promise.all([
    readTextFile(MSU_FILE),
    readTextFile(MDOT_FILE),
    fs.stat(MSU_FILE),
    fs.stat(MDOT_FILE),
  ]);

  const msuParsed = parseMsuDollarLines(msuContent);
  const msuRates = mapMsuOperations(msuParsed.lines);
  const mdotParsed = parseMdotCsv(mdotContent);
  const mdotItems = mapMdotItems(mdotParsed.records);

  const snapshot = {
    schemaVersion: 1,
    snapshotKey: SNAPSHOT_KEY,
    retrievedAt: new Date().toISOString(),
    sources: {
      msu: {
        file: path.basename(MSU_FILE),
        title: msuParsed.header.Title || null,
        sourceUrl: msuParsed.header['Source URL'] || null,
        pages: toNumber(msuParsed.header.Pages),
        stats: {
          totalParsedLines: toNumber(msuParsed.header['Total parsed lines']),
          linesContainingDollar: toNumber(msuParsed.header["Lines containing '$'"]),
        },
        fileModifiedAt: msuStats.mtime.toISOString(),
        extractedRatesUsdPerAcre: msuRates.rates,
        matchedOperations: msuRates.matches,
      },
      mdot: {
        file: path.basename(MDOT_FILE),
        rowCount: mdotParsed.records.length,
        fileModifiedAt: mdotStats.mtime.toISOString(),
        extractedItems: mdotItems.items,
        matchedItems: mdotItems.matches,
      },
    },
  };

  return snapshot;
}

function formatSnapshotRow(row, fromCache) {
  const snapshot = row.payload || {};
  if (!snapshot.retrievedAt && row.retrieved_at) {
    snapshot.retrievedAt = row.retrieved_at;
  }
  return {
    snapshotId: row.id,
    snapshotKey: row.snapshot_key,
    retrievedAt: row.retrieved_at,
    fromCache,
    snapshot,
  };
}

async function getOrCreatePricingSnapshot(queries, options = {}) {
  ensureQueriesContract(queries);
  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    const cached = await queries.getLatestPricingSnapshot(SNAPSHOT_KEY);
    if (cached) {
      return formatSnapshotRow(cached, true);
    }
  }

  const snapshotPayload = await buildPricingSnapshotFromLocalFiles();
  const saved = await queries.savePricingSnapshot(SNAPSHOT_KEY, snapshotPayload);
  snapshotPayload.retrievedAt = saved.retrieved_at;

  return {
    snapshotId: saved.id,
    snapshotKey: saved.snapshot_key,
    retrievedAt: saved.retrieved_at,
    fromCache: false,
    snapshot: snapshotPayload,
  };
}

module.exports = {
  SNAPSHOT_KEY,
  buildPricingSnapshotFromLocalFiles,
  getOrCreatePricingSnapshot,
};
