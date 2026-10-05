/* Shared plumbing for the refresh pipeline: polite fetching, a disk cache,
   and reading/writing the catalogue files.

   Every request identifies itself honestly and is paced per host. Nothing
   here impersonates a browser. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = path.join(ROOT, '.cache');
export const UA = 'ShelfBot/1.0 (+https://github.com/Goodly58/media-shelf)';
export const IMDB_DIR = process.env.IMDB_DATASETS || path.join(os.tmpdir(), 'imdb-datasets');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const today = () => new Date().toISOString().slice(0, 10);
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

fs.mkdirSync(CACHE, { recursive: true });

/* ------------------------------------------------------------------ fetch */

const lastHit = new Map();
async function pace(host, ms) {
  const wait = (lastHit.get(host) || 0) + ms - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} ${url}`); this.status = status; }
}

/** Requests per host this run, answered (a clean 404 counts) or failed, for the health check. */
export const traffic = {};

/**
 * GET with pacing, retries and backoff. Returns null on 404/410.
 * type: 'json' | 'text' | 'response'
 * answers: further statuses that are an answer rather than a failure (returned as { status }).
 */
export async function get(url, opts = {}) {
  const host = new URL(url).host;
  const t = traffic[host] || (traffic[host] = { ok: 0, failed: 0 });
  try { const r = await withRetries(url, host, opts); t.ok++; return r; }
  catch (e) { t.failed++; throw e; }
}
async function withRetries(url, host, { type = 'json', paceMs = 1000, retries = 4, timeout = 45000, headers = {}, method = 'GET', body, answers = [] } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace(host, paceMs);
    try {
      const res = await fetch(url, {
        method, body,
        headers: { 'User-Agent': UA, 'Api-User-Agent': UA, ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) return null;
      if (answers.includes(res.status)) return { status: res.status };
      if (res.status === 429 || res.status === 202 || res.status >= 500) {
        lastErr = new HttpError(res.status, url);
        const ra = Number(res.headers.get('retry-after'));
        await sleep(ra > 0 ? ra * 1000 : 4000 * 2 ** attempt);
        continue;
      }
      if (!res.ok) throw new HttpError(res.status, url);
      if (type === 'response') return res;
      return type === 'json' ? await res.json() : await res.text();
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      await sleep(3000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/* ------------------------------------------------------------------ cache */

export function loadCache(name, fallback = {}) {
  const f = path.join(CACHE, name + '.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; }
}

export function saveCache(name, value) {
  const f = path.join(CACHE, name + '.json');
  fs.writeFileSync(f + '.tmp', JSON.stringify(value));
  fs.renameSync(f + '.tmp', f);
}

/* --------------------------------------------------------------- catalogue */

export const KINDS = ['games', 'books', 'movies', 'shows'];
const dataFile = (kind) => path.join(ROOT, 'data', kind + '.json');

export function readData(kind) {
  return JSON.parse(fs.readFileSync(dataFile(kind), 'utf8'));
}

/* One object per line: small diffs, still valid JSON. */
/** A row as written: empty fields left out. */
export function compact(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
    o[k] = v;
  }
  return o;
}
export function writeData(kind, rows) {
  fs.writeFileSync(dataFile(kind), '[\n' + rows.map((r) => JSON.stringify(compact(r))).join(',\n') + '\n]\n');
}

/* ------------------------------------------------------------------ titles */

const ENTITY = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
export function decode(s) {
  return String(s ?? '').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, b) => {
    if (b[0] === '#') {
      const n = b[1] === 'x' || b[1] === 'X' ? parseInt(b.slice(2), 16) : parseInt(b.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITY[b.toLowerCase()] ?? m;
  });
}

/* Fold a title to a comparison key: accents, punctuation, "&"/"and" and a
   leading article all stop mattering. */
export function fold(s) {
  return decode(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}
