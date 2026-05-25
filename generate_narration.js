#!/usr/bin/env node
/**
 * generate_narration.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates MP3 narration for all meditation pointers in Return to Source.
 * Reads pointer texts and filenames DIRECTLY from index.html — no hardcoding.
 * Files are saved to ./audio/ptr_g{GI}_p{PI}.mp3
 *
 * USAGE
 * ─────
 *   # Dry run — verify count and list all filenames (no API calls, no files written)
 *   node generate_narration.js --dry-run
 *
 *   # OpenAI TTS (recommended)
 *   OPENAI_API_KEY=sk-... node generate_narration.js --provider openai
 *
 *   # ElevenLabs TTS
 *   ELEVENLABS_API_KEY=... node generate_narration.js --provider elevenlabs
 *
 * OPTIONS
 *   --provider  openai | elevenlabs   (default: openai)
 *   --voice     voice name or ID      (default: nova for OpenAI)
 *   --speed     0.25–1.0             (default: 0.80)
 *   --dry-run   verify count + list all files without generating anything
 *   --from gi:pi  resume from a specific pointer (skips earlier ones)
 *
 * RECOMMENDED OPENAI VOICES FOR MEDITATION
 *   nova    — calm, warm (best for this app)
 *   shimmer — gentle, soft
 *   echo    — neutral, clear
 *   onyx    — deep, grounded
 *
 * AFTER RUNNING
 * ─────────────
 * Upload the audio/ folder to your GitHub repo root alongside index.html.
 * The app automatically uses MP3s and falls back to speechSynthesis for
 * any file that is missing — no code changes needed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const fs    = require('fs');
const path  = require('path');
const https = require('https');

// ── Step 1: Read index.html and extract GROUPS array ─────────────────────────
const HTML_PATH = path.join(__dirname, 'index.html');
if (!fs.existsSync(HTML_PATH)) {
  console.error('\n❌  index.html not found in the same folder as this script.');
  console.error('    Place generate_narration.js alongside index.html and re-run.\n');
  process.exit(1);
}

const html = fs.readFileSync(HTML_PATH, 'utf8');

// Extract the GROUPS array literal from the HTML source
const groupsMatch = html.match(/const GROUPS\s*=\s*(\[[\s\S]*?\]);\s*\/\/ ─── Flatten/);
if (!groupsMatch) {
  console.error('\n❌  Could not find GROUPS array in index.html.');
  console.error('    Make sure you are using the latest version of index.html.\n');
  process.exit(1);
}

let GROUPS;
try {
  // Safe eval inside a local scope — only reads the array literal
  eval('GROUPS = ' + groupsMatch[1]); // eslint-disable-line no-eval
} catch (e) {
  console.error('\n❌  Failed to parse GROUPS array:', e.message, '\n');
  process.exit(1);
}

// ── Step 2: Build pointer list (mirrors ALL[] logic in the app) ───────────────
const POINTERS = [];
GROUPS.forEach((g, gi) => {
  g.pointers.forEach((p, pi) => {
    POINTERS.push({
      gi,
      pi,
      level:    g.minLevel || 'beginner',
      text:     p.en,                        // English text — matches app's ST.lang='en'
      filename: 'audio/ptr_g' +
                String(gi).padStart(2, '0') +
                '_p' +
                String(pi).padStart(2, '0') +
                '.mp3',
    });
  });
});

// ── Step 3: Verify count before doing anything ────────────────────────────────
const EXPECTED = 121;
if (POINTERS.length !== EXPECTED) {
  console.warn(`\n⚠  Expected ${EXPECTED} pointers but found ${POINTERS.length}.`);
  console.warn('   The pointer count in index.html has changed.');
  console.warn('   Proceeding anyway — review the dry-run output carefully.\n');
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag) {
  const eq = args.find(a => a.startsWith(flag + '='));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const PROVIDER  = getArg('--provider') || 'openai';
const VOICE_ARG = getArg('--voice')    || '';
const SPEED     = Math.min(1.0, Math.max(0.25, parseFloat(getArg('--speed') || '0.80')));
const DRY_RUN   = args.includes('--dry-run');
const FROM_ARG  = getArg('--from') || '';

const OPENAI_VOICE     = VOICE_ARG || 'nova';
const ELEVENLABS_VOICE = VOICE_ARG || 'EXAVITQu4vr4xnSDxMaL'; // ElevenLabs "Sarah"

// ── Output dir ────────────────────────────────────────────────────────────────
const OUT_DIR = path.join(__dirname, 'audio');
if (!DRY_RUN && !fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function outPath(p) {
  return path.join(__dirname, p.filename);
}

// ── Filter: skip already-generated files, and honour --from ──────────────────
let [fromGi, fromPi] = FROM_ARG
  ? FROM_ARG.split(':').map(Number)
  : [-1, -1];

const toGenerate = POINTERS.filter(p => {
  if (FROM_ARG && (p.gi < fromGi || (p.gi === fromGi && p.pi < fromPi))) return false;
  return !fs.existsSync(outPath(p));
});

// ── Summary header ────────────────────────────────────────────────────────────
const byLevel = {};
POINTERS.forEach(p => { byLevel[p.level] = (byLevel[p.level] || 0) + 1; });

console.log('\n┌──────────────────────────────────────────────┐');
console.log('│   Return to Source — Narration Generator     │');
console.log('└──────────────────────────────────────────────┘');
console.log(`  Source   : index.html (live extract)`);
console.log(`  Total    : ${POINTERS.length} pointers`);
console.log(`  Beginner : ${byLevel.beginner || 0}`);
console.log(`  Seeker   : ${byLevel.seeker   || 0}`);
console.log(`  Advanced : ${byLevel.advanced || 0}`);
console.log(`  Sahaja   : ${byLevel.sahaja   || 0}`);
console.log(`  Provider : ${PROVIDER}`);
console.log(`  Voice    : ${PROVIDER === 'openai' ? OPENAI_VOICE : ELEVENLABS_VOICE}`);
console.log(`  Speed    : ${SPEED}`);
console.log(`  To gen   : ${toGenerate.length} (${POINTERS.length - toGenerate.length} already exist)`);

// ── DRY RUN ───────────────────────────────────────────────────────────────────
if (DRY_RUN) {
  console.log('\n── Dry run: all files that would be generated ──\n');
  if (toGenerate.length === 0) {
    console.log('  All files already exist. Nothing to generate.');
  } else {
    toGenerate.forEach((p, i) => {
      const exists = fs.existsSync(outPath(p)) ? '[EXISTS]' : '';
      console.log(
        `  ${String(i + 1).padStart(3)}.  [${p.level.padEnd(8)}]  ${p.filename.padEnd(30)}  "${p.text.slice(0, 60)}"  ${exists}`
      );
    });
  }
  console.log(`\n  Total to generate: ${toGenerate.length} / ${POINTERS.length}`);
  if (POINTERS.length === EXPECTED) {
    console.log(`  ✓ Count confirmed: ${POINTERS.length} = ${EXPECTED} expected\n`);
  } else {
    console.log(`  ⚠ Count mismatch: ${POINTERS.length} found vs ${EXPECTED} expected\n`);
  }
  console.log('  Run without --dry-run and with your API key to generate.\n');
  process.exit(0);
}

// ── Guard: confirm count before any API calls ─────────────────────────────────
if (POINTERS.length !== EXPECTED) {
  console.error(`\n❌  Count mismatch: ${POINTERS.length} pointers found, expected ${EXPECTED}.`);
  console.error('    Run with --dry-run to inspect. Aborting to avoid partial generation.\n');
  process.exit(1);
}

if (toGenerate.length === 0) {
  console.log('\n  ✓ All files already exist. Nothing to generate.\n');
  process.exit(0);
}

// ── API key check ─────────────────────────────────────────────────────────────
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const EL_KEY     = process.env.ELEVENLABS_API_KEY || '';

if (PROVIDER === 'openai' && !OPENAI_KEY) {
  console.error('\n❌  OPENAI_API_KEY environment variable is not set.');
  console.error('    Run:  export OPENAI_API_KEY=sk-...\n');
  process.exit(1);
}
if (PROVIDER === 'elevenlabs' && !EL_KEY) {
  console.error('\n❌  ELEVENLABS_API_KEY environment variable is not set.');
  console.error('    Run:  export ELEVENLABS_API_KEY=...\n');
  process.exit(1);
}

console.log(`\n  Starting generation of ${toGenerate.length} files...\n`);

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpsPost(options, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${buf.toString().slice(0, 300)}`));
        } else {
          resolve(buf);
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── OpenAI TTS ────────────────────────────────────────────────────────────────
async function openaiTTS(text) {
  const body = JSON.stringify({
    model:           'tts-1-hd',
    input:           text,
    voice:           OPENAI_VOICE,
    speed:           SPEED,
    response_format: 'mp3',
  });
  return httpsPost({
    hostname: 'api.openai.com',
    path:     '/v1/audio/speech',
    method:   'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_KEY}`,
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────
async function elevenLabsTTS(text) {
  const body = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2',
    voice_settings: { stability: 0.75, similarity_boost: 0.75, style: 0.0 },
  });
  return httpsPost({
    hostname: 'api.elevenlabs.io',
    path:     `/v1/text-to-speech/${ELEVENLABS_VOICE}`,
    method:   'POST',
    headers: {
      'xi-api-key':     EL_KEY,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Accept':         'audio/mpeg',
    },
  }, body);
}

// ── Main generation loop ──────────────────────────────────────────────────────
(async () => {
  let done = 0, failed = 0;

  for (const p of toGenerate) {
    const dest  = outPath(p);
    const label = `[${p.level.padEnd(8)}] g${String(p.gi).padStart(2,'0')}/p${String(p.pi).padStart(2,'0')}`;
    process.stdout.write(`  ${label}  "${p.text.slice(0, 55).padEnd(55)}"  `);
    try {
      const audioData = PROVIDER === 'openai'
        ? await openaiTTS(p.text)
        : await elevenLabsTTS(p.text);
      fs.writeFileSync(dest, audioData);
      done++;
      console.log(`✓  ${(audioData.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      failed++;
      console.log(`✗  ${err.message.slice(0, 80)}`);
    }
    // 100 ms courtesy delay between requests
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`  Generated : ${done}`);
  if (failed > 0) {
    console.log(`  Failed    : ${failed}  (re-run to retry — existing files are skipped)`);
  }
  console.log(`  Total     : ${POINTERS.length}`);
  console.log('──────────────────────────────────────────────');

  if (done + (POINTERS.length - toGenerate.length) === POINTERS.length) {
    console.log('\n  ✅  All 121 files complete.');
    console.log('  Upload the audio/ folder to your GitHub repo root alongside index.html.\n');
  } else {
    console.log('\n  ⚠   Some files are missing. Re-run to complete.\n');
  }
})();
