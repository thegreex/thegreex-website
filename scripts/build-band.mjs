#!/usr/bin/env node
// Leest band-src/, versleutelt en schrijft band/data.enc.json
// Gebruik: node scripts/build-band.mjs
// Of: BAND_PASSWORD=geheim node scripts/build-band.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { webcrypto } from 'crypto';
import { createInterface } from 'readline';

const subtle = webcrypto.subtle;
const getRandomValues = (buf) => webcrypto.getRandomValues(buf);

const SONGS_DIR  = 'band-src/songs';
const GIGS_DIR   = 'band-src/gigs';
const OUT_FILE   = 'band/data.enc.json';
const ITERATIONS = 600_000;

async function promptPassword() {
  if (process.env.BAND_PASSWORD) return process.env.BAND_PASSWORD;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => {
    process.stderr.write('Wachtwoord: ');
    rl.question('', answer => { rl.close(); resolve(answer); });
  });
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const km = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: ITERATIONS },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
}

async function encrypt(key, data) {
  const iv = getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  return { iv: Array.from(iv), ct: Array.from(new Uint8Array(ct)) };
}

function readSongs() {
  if (!existsSync(SONGS_DIR)) throw new Error(`Map niet gevonden: ${SONGS_DIR}`);
  const songs = {};
  for (const f of readdirSync(SONGS_DIR).sort()) {
    if (!f.endsWith('.cho')) continue;
    const slug = basename(f, '.cho');
    songs[slug] = readFileSync(join(SONGS_DIR, f), 'utf8');
  }
  return songs;
}

function readGigs(slugs) {
  if (!existsSync(GIGS_DIR)) return [];
  const gigs = [];
  for (const f of readdirSync(GIGS_DIR).sort()) {
    if (!f.endsWith('.json')) continue;
    let gig;
    try { gig = JSON.parse(readFileSync(join(GIGS_DIR, f), 'utf8')); }
    catch (e) { throw new Error(`Ongeldige JSON in ${f}: ${e.message}`); }
    // Valideer slugs
    for (const set of gig.sets || []) {
      for (const item of set.songs || []) {
        if (!slugs.has(item.song)) {
          throw new Error(`${f}: slug "${item.song}" bestaat niet in songs/`);
        }
      }
    }
    gigs.push(gig);
  }
  return gigs;
}

async function main() {
  const password = await promptPassword();
  if (!password) throw new Error('Geen wachtwoord opgegeven');

  const songs = readSongs();
  const slugs = new Set(Object.keys(songs));
  console.error(`✓ ${slugs.size} nummer(s) gevonden`);

  const gigs = readGigs(slugs);
  console.error(`✓ ${gigs.length} optreden(s) gevonden`);

  const salt = getRandomValues(new Uint8Array(16));
  const key  = await deriveKey(password, salt);
  const { iv, ct } = await encrypt(key, { songs, gigs });

  writeFileSync(OUT_FILE, JSON.stringify({ v: 1, iterations: ITERATIONS, salt: Array.from(salt), iv, data: ct }));
  console.error(`✓ Versleuteld → ${OUT_FILE}`);
}

main().catch(e => { console.error('Fout:', e.message); process.exit(1); });
