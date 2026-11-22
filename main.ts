// token-radar-01's entry: a token launch radar that reads the sealed snapshot and writes a ranked
// board a reader can act on. The scoring model (lib/model.ts, radar-2: size power law, seven-day
// momentum, category, age and chain-quality multipliers) scores every protocol the watchlist names
// plus the strongest pre-token protocols below the watchlist floor, so the board carries 200 rows:
// all 40 watchlist protocols, then 160 early candidates picked by TVL. Every row carries the steps
// to farm that protocol before its token exists, with what each step costs and how long it takes.
//
// The run reads /input/snapshot.json (or --input <file|dir>), checks the board against the gate's
// shape, then writes /output: board.json (the ranked rows), data.js (the same data for the page),
// copies of this repository's dashboard/ and screenshots/, and last dossier.json, which the judge
// reads, built with the vendored make.fun library. Both runs of the program must write the same
// bytes; nothing here reads the clock, the network or anything outside its arguments and /input.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board. The page
// states the model, covers the whole watchlist and gives every protocol a farm plan; the screenshots
// show the board, one protocol's detail view and a filtered view.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import type { Snapshot } from './lib/model.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** One line on stderr, then exit 2: the return type `never` lets TS know control does not come back. */
function die(message: string): never {
  process.stderr.write(message);
  process.exit(2);
  throw new Error('unreachable'); // keeps `never` honest even without Node's type definitions
}

/** The snapshot out of the file's bytes, or one line on stderr and exit 2 when it cannot be scored. */
function loadSnapshot(path: string): Snapshot {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    die(`token radar: cannot read the snapshot at ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
  try {
    return parseSnapshot(text);
  } catch (err) {
    die(`token radar: the snapshot at ${path} is not one this model can score: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

const snapshot = loadSnapshot(inputFile);
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const boardSlugs = new Set(board.map((r) => r.slug));
const covered = snapshot.watchlist.filter((slug) => boardSlugs.has(slug)).length;
process.stdout.write(
  `token radar: model ${radar.model_version}, as of ${snapshot.as_of}: ${board.length} rows (${snapshot.watchlist.length} on the watchlist, ${covered} covered, ${radar.early_size} early candidates below the $${(snapshot.floor_usd / 1e6).toFixed(0)}M floor), ${radar.live_size} live-token protocols set aside\n` +
    `token radar: wrote board.json (${board.length} rows), data.js, dashboard (3 files), screenshots (${shots.length} images) and dossier.json in ${out}\n`,
);
