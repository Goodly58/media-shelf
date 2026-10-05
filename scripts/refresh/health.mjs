/* Source health for the weekly refresh.

   A source that breaks (a site changes its pages, blocks the crawler, or an API
   key stops working) is skipped by run.mjs so the others still update. That keeps
   the site up, but on its own nobody would notice the scores going stale. So each
   run is judged here by what it actually did:

   - requests per site: most of a site's requests failing means it is down or blocking us;
   - answers per source: of the entries a source checked this run (their `at` falls
     inside the run), far fewer than usual coming back with a score means its pages
     or API changed shape;
   - full crawls that shrank sharply, steps that threw, and catalogues the run
     refused to overwrite because they would have shrunk.

   run.mjs writes the verdict to .cache/health.json. The workflow then runs this
   file, which prints a table and exits non-zero when anything is wrong, so the run
   fails and GitHub emails the repository owner.

   node scripts/refresh/health.mjs      check the last run's verdict */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCache, CACHE } from './lib.mjs';

/* [cache, label, step, answered(entry), usual]
   usual: the share of checked entries that normally come back with an answer
   (Metacritic lists only a third of the games we ask about). Half of that is a fault. */
export const SOURCES = [
  ['wikidata', 'Wikidata', 'wikidata', (e) => Boolean(e.wiki), 0.98],
  ['images', 'Wikipedia posters', 'images', (e) => Boolean(e.img), 0.97],
  ['wp-categories', 'Wikipedia categories', 'categories', (e) => Boolean(e.cats && e.cats.length), 1],
  ['tvmaze', 'TVmaze posters', 'tvmaze', (e) => Boolean(e.img), 0.96],
  ['rt', 'Rotten Tomatoes', 'rt', (e) => e.score != null, 0.9],
  ['steam-reviews', 'Steam reviews', 'steam', (e) => e.score != null, 0.96],
  ['steam-tags', 'Steam tags', 'steam', (e) => Boolean(e.tags && e.tags.length), 0.94],
  ['mc-games', 'Metacritic games', 'gamesmc', (e) => e.score != null, 0.33],
  ['goodreads', 'Goodreads', 'books', (e) => e.rating != null, 0.9],
  ['yt-check', 'YouTube trailer checks', 'trailers', (e) => e.ok === true, 0.75],
];
// Full crawls, judged by size against the previous run: [cache, label, step, smallest share kept].
export const CRAWLS = [
  ['imdb-selected', 'IMDb titles', 'imdb', 0.9],
  ['mc-movies', 'Metacritic films', 'metacritic', 0.8],
  ['mc-tv', 'Metacritic series', 'metacritic', 0.8],
  ['steam-popular', 'Steam popular list', 'steamlist', 0.5],
];
// Below this many checks or requests, a bad rate is chance rather than a fault.
const MIN_SAMPLE = 40;
const MIN_REQUESTS = 20;

/** Sizes of the crawl caches before a run, to compare with after it. */
export function snapshot(load = loadCache) {
  const out = {};
  for (const [name] of CRAWLS) { const c = load(name, []); out[name] = Array.isArray(c) ? c.length : Object.keys(c).length; }
  return out;
}

/**
 * steps: [{ name, seconds, error? }] for the steps that ran. since: the run's start time.
 * traffic: { host: { ok, failed } } from lib.mjs. notes: further problems found by run.mjs.
 */
export function assess({ since, steps, snap = {}, traffic = {}, notes = [], load = loadCache }) {
  const ran = new Set(steps.map((s) => s.name));
  const problems = [...notes];
  const rows = [];
  for (const s of steps) if (s.error) problems.push(`${s.name}: failed (${s.error})`);
  for (const [host, t] of Object.entries(traffic)) {
    const n = t.ok + t.failed;
    if (n >= MIN_REQUESTS && t.failed / n > 0.5) problems.push(`${host}: ${t.failed} of ${n} requests failed`);
  }
  for (const [name, label, step, answered, usual] of SOURCES) {
    if (!ran.has(step)) continue;
    const entries = Object.values(load(name, {})).filter((e) => e && e.at >= since);
    const ok = entries.filter(answered).length;
    const rate = entries.length ? ok / entries.length : null;
    const verdict = entries.length >= MIN_SAMPLE && rate < usual / 2
      ? `only ${Math.round(rate * 100)}% answered, usually about ${Math.round(usual * 100)}%` : 'ok';
    if (verdict !== 'ok') problems.push(`${label}: ${verdict}`);
    rows.push({ label, checked: entries.length, answered: ok, verdict });
  }
  for (const [name, label, step, keep] of CRAWLS) {
    if (!ran.has(step)) continue;
    const c = load(name, []);
    const now = Array.isArray(c) ? c.length : Object.keys(c).length;
    const was = snap[name] || 0;
    const verdict = !now ? 'came back empty' : was && now < was * keep ? `shrank from ${was} to ${now}` : 'ok';
    if (verdict !== 'ok') problems.push(`${label}: ${verdict}`);
    rows.push({ label, checked: now, answered: null, verdict });
  }
  return { at: new Date().toISOString(), ok: !problems.length, problems, rows, traffic, steps };
}

export function save(report) {
  fs.writeFileSync(path.join(CACHE, 'health.json'), JSON.stringify(report, null, 2) + '\n');
}

export function table(report) {
  const lines = ['| Source | Checked | Answered | Status |', '| --- | ---: | ---: | --- |'];
  for (const r of report.rows) lines.push(`| ${r.label} | ${r.checked} | ${r.answered == null ? '' : r.answered} | ${r.verdict === 'ok' ? 'ok' : '**' + r.verdict + '**'} |`);
  const hosts = Object.entries(report.traffic || {}).sort((a, b) => b[1].ok + b[1].failed - a[1].ok - a[1].failed)
    .map(([h, t]) => `${h} ${t.ok + t.failed}${t.failed ? ` (${t.failed} failed)` : ''}`).join(', ');
  const steps = report.steps.filter((s) => !s.error).map((s) => `${s.name} ${s.seconds}s`).join(', ');
  return lines.join('\n') + (hosts ? `\n\nRequests: ${hosts}` : '') + (steps ? `\n\nSteps: ${steps}` : '');
}

// CLI: judge the last run.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try { report = JSON.parse(fs.readFileSync(path.join(CACHE, 'health.json'), 'utf8')); }
  catch { console.error('No health report: the refresh did not finish.'); process.exit(1); }
  const text = (report.ok ? '### Sources: all fine\n\n' : `### Sources: ${report.problems.length} problem(s)\n\n${report.problems.map((p) => `- ${p}`).join('\n')}\n\n`) + table(report);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  for (const p of report.problems) console.log(`::error title=Refresh source problem::${p}`);
  process.exit(report.ok ? 0 : 1);
}
