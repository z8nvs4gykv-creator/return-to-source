#!/usr/bin/env node
/**
 * generate_continuous.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds 5 continuous narration MP3 tracks from the 121 individual pointer
 * MP3s. One track per level plays like a single audio file — no JavaScript
 * needed to advance pointers, so iOS lock screen works identically to mantra.mp3.
 *
 * Also writes audio/cues.json so the app can sync visual pointer text to the
 * continuous track's playback position when the screen is unlocked.
 *
 * OUTPUT FILES
 * ────────────
 *   audio/all_levels_continuous.mp3      all 121 pointers, level-appropriate gaps
 *   audio/beginner_continuous.mp3        31 beginner pointers, 10 s gaps
 *   audio/seeker_continuous.mp3          34 seeker pointers,   22 s gaps
 *   audio/advanced_continuous.mp3        35 advanced pointers, 32 s gaps
 *   audio/natural_state_continuous.mp3   21 sahaja pointers,   32 s gaps
 *   audio/cues.json                      timing cues for in-app sync
 *
 * USAGE
 * ─────
 *   # Dry run — show what will be built (no files written)
 *   node generate_continuous.js --dry-run
 *
 *   # Build all five tracks (takes ~2–5 minutes)
 *   node generate_continuous.js
 *
 *   # Build one track only
 *   node generate_continuous.js --level beginner
 *
 * REQUIRES
 *   ffmpeg + ffprobe  →  brew install ffmpeg
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ── Verify ffmpeg / ffprobe are available ─────────────────────────────────────
['ffmpeg','ffprobe'].forEach(tool => {
  try { execSync(`which ${tool}`, { stdio: 'pipe' }); }
  catch(e) {
    console.error(`\n❌  ${tool} not found. Install with:  brew install ffmpeg\n`);
    process.exit(1);
  }
});

// ── Extract GROUPS array from index.html (same technique as generate_narration.js) ──
const HTML_PATH = path.join(__dirname, 'index.html');
if (!fs.existsSync(HTML_PATH)) {
  console.error('\n❌  index.html not found. Run from the repo root.\n');
  process.exit(1);
}
const html = fs.readFileSync(HTML_PATH, 'utf8');
const groupsMatch = html.match(/const GROUPS\s*=\s*(\[[\s\S]*?\]);\s*\/\/ ─── Flatten/);
if (!groupsMatch) {
  console.error('\n❌  Could not find GROUPS array in index.html.\n');
  process.exit(1);
}
let GROUPS;
try { eval('GROUPS = ' + groupsMatch[1]); } // eslint-disable-line no-eval
catch(e) { console.error('\n❌  Failed to parse GROUPS:', e.message,'\n'); process.exit(1); }

// ── Build flat pointer list ───────────────────────────────────────────────────
const POINTERS = [];
GROUPS.forEach((g, gi) => {
  g.pointers.forEach((p, pi) => {
    POINTERS.push({
      gi, pi,
      level:    g.minLevel || 'beginner',
      text:     p.en,
      filename: 'audio/ptr_g' + String(gi).padStart(2,'0') + '_p' + String(pi).padStart(2,'0') + '.mp3',
    });
  });
});
console.log(`\n  Source: index.html  →  ${POINTERS.length} pointers found`);

// ── Gap durations (seconds) after each pointer narration ─────────────────────
const GAP = { beginner: 10, seeker: 22, advanced: 32, sahaja: 32 };

// ── Track definitions ─────────────────────────────────────────────────────────
const TRACKS = [
  { key: 'all_levels', label: 'All levels',   filter: () => true,                  gapFn: p => GAP[p.level] || 10, file: 'audio/all_levels_continuous.mp3'      },
  { key: 'beginner',   label: 'Beginner',     filter: p => p.level==='beginner',   gapFn: () => GAP.beginner,      file: 'audio/beginner_continuous.mp3'        },
  { key: 'seeker',     label: 'Seeker',       filter: p => p.level==='seeker',     gapFn: () => GAP.seeker,        file: 'audio/seeker_continuous.mp3'          },
  { key: 'advanced',   label: 'Advanced',     filter: p => p.level==='advanced',   gapFn: () => GAP.advanced,      file: 'audio/advanced_continuous.mp3'        },
  { key: 'sahaja',     label: 'Natural State',filter: p => p.level==='sahaja',     gapFn: () => GAP.sahaja,        file: 'audio/natural_state_continuous.mp3'   },
];

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LEVEL   = (() => { const i = args.indexOf('--level'); return i>=0 ? args[i+1] : null; })();

// ── Temp directory ────────────────────────────────────────────────────────────
const TMP = '/tmp/rts_continuous';
if (!DRY_RUN) fs.mkdirSync(TMP, { recursive: true });

// ── Generate silence files ────────────────────────────────────────────────────
const _silCache = {};
function silenceFile(seconds) {
  if (_silCache[seconds]) return _silCache[seconds];
  const f = path.join(TMP, `silence_${seconds}s.mp3`);
  if (!fs.existsSync(f)) {
    execSync(
      `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t ${seconds} -q:a 9 -acodec libmp3lame "${f}" -y`,
      { stdio: 'pipe' }
    );
  }
  _silCache[seconds] = f;
  return f;
}

// ── Get MP3 duration via ffprobe ──────────────────────────────────────────────
function getDuration(filePath) {
  try {
    const out = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
    ).trim();
    return parseFloat(out) || 0;
  } catch(e) { return 0; }
}

// ── Build one continuous track ────────────────────────────────────────────────
function buildTrack(track) {
  const pointers = POINTERS.filter(track.filter);
  console.log(`\n── ${track.label} (${pointers.length} pointers) → ${track.file}`);

  if (DRY_RUN) {
    let t = 1; // intro silence
    pointers.forEach((p, i) => {
      const est = 18; // rough estimate when dry-running
      console.log(`  ${String(i+1).padStart(3)}.  g${String(p.gi).padStart(2,'0')}/p${String(p.pi).padStart(2,'0')}  [${p.level.padEnd(8)}]  t=${t.toFixed(1)}s  "${p.text.slice(0,50)}"`);
      t += est + (i < pointers.length-1 ? track.gapFn(p) : 0);
    });
    console.log(`  Estimated total: ~${(t/60).toFixed(1)} min`);
    return null;
  }

  // Generate silence files needed
  const gaps = [...new Set(pointers.map(track.gapFn))];
  gaps.forEach(g => silenceFile(g));
  const introSil = silenceFile(1);

  const concatLines = [];
  const cues = [];
  let t = 0;

  // 1 s intro silence so first pointer doesn't cut in immediately
  concatLines.push(`file '${introSil}'`);
  t += 1;

  for (let i = 0; i < pointers.length; i++) {
    const p   = pointers[i];
    const abs = path.join(__dirname, p.filename);

    if (!fs.existsSync(abs)) {
      console.warn(`  ⚠ Missing ${p.filename} — skipped`);
      continue;
    }

    const dur = getDuration(abs);
    if (dur <= 0) { console.warn(`  ⚠ Zero duration ${p.filename} — skipped`); continue; }

    cues.push({ gi: p.gi, pi: p.pi, start: parseFloat(t.toFixed(3)), duration: parseFloat(dur.toFixed(3)) });
    concatLines.push(`file '${abs}'`);
    t += dur;

    if (i < pointers.length - 1) {
      const g = track.gapFn(p);
      concatLines.push(`file '${silenceFile(g)}'`);
      t += g;
    }
  }

  // Write concat list
  const listFile = path.join(TMP, `${track.key}_list.txt`);
  fs.writeFileSync(listFile, concatLines.join('\n'));

  // Run ffmpeg concat
  const outAbs = path.join(__dirname, track.file);
  process.stdout.write(`  Encoding...`);
  execSync(
    `ffmpeg -f concat -safe 0 -i "${listFile}" -c:a libmp3lame -q:a 4 "${outAbs}" -y`,
    { stdio: 'pipe' }
  );

  const mb   = (fs.statSync(outAbs).size / 1024 / 1024).toFixed(1);
  const mins = (t / 60).toFixed(1);
  console.log(` ✓  ${mb} MB, ${mins} min, ${cues.length} cues`);
  return cues;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('\n┌──────────────────────────────────────────────────┐');
console.log('│   Return to Source — Continuous Track Generator   │');
console.log('└──────────────────────────────────────────────────┘');
if (DRY_RUN) console.log('  (dry run — no files will be written)\n');

const allCues = {};
let built = 0;

for (const track of TRACKS) {
  if (LEVEL && track.key !== LEVEL) continue;
  const cues = buildTrack(track);
  if (cues) { allCues[track.key] = cues; built++; }
}

// ── Write / merge cues.json ───────────────────────────────────────────────────
if (!DRY_RUN && built > 0) {
  const cuesPath = path.join(__dirname, 'audio', 'cues.json');
  let existing = {};
  if (fs.existsSync(cuesPath)) {
    try { existing = JSON.parse(fs.readFileSync(cuesPath, 'utf8')); } catch(e) {}
  }
  const merged = { ...existing, ...allCues };
  fs.writeFileSync(cuesPath, JSON.stringify(merged));
  console.log(`\n  ✅  audio/cues.json written  (${Object.keys(merged).length} tracks)`);
  console.log('\n  Next steps:');
  console.log('    git add audio/');
  console.log('    git commit -m "add continuous narration tracks"');
  console.log('    GIT_SSH_COMMAND="ssh -i ~/.ssh/github_rts" git push origin main\n');
}
