// Transpose engine – used by app.js (browser) and tests (Node)

export const SHARPS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const FLATS  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

// Keys that prefer flat notation
const FLAT_KEYS = new Set([
  'F','Bb','Eb','Ab','Db','Gb',
  'Dm','Gm','Cm','Fm','Bbm','Ebm'
]);

export function noteToIndex(note) {
  let i = SHARPS.indexOf(note);
  if (i !== -1) return i;
  return FLATS.indexOf(note);
}

function wrap(i) { return ((i % 12) + 12) % 12; }

export function indexToNote(i, useSharps) {
  return useSharps ? SHARPS[wrap(i)] : FLATS[wrap(i)];
}

export function prefersSharps(key) {
  if (!key) return true;
  const root = key.endsWith('m') ? key.slice(0, -1) : key;
  return !FLAT_KEYS.has(key) && !FLAT_KEYS.has(root);
}

export function transposeKey(key, semitones) {
  if (!semitones) return key;
  const isMinor = key.endsWith('m');
  const root = isMinor ? key.slice(0, -1) : key;
  const idx = noteToIndex(root);
  if (idx === -1) return key;
  const newIdx = wrap(idx + semitones);
  const suffix = isMinor ? 'm' : '';
  const flatName = FLATS[newIdx] + suffix;
  const sharpName = SHARPS[newIdx] + suffix;
  return FLAT_KEYS.has(flatName) ? flatName : sharpName;
}

export function semitonesBetween(fromKey, toKey) {
  const fromRoot = fromKey.endsWith('m') ? fromKey.slice(0, -1) : fromKey;
  const toRoot   = toKey.endsWith('m')   ? toKey.slice(0, -1)   : toKey;
  const fi = noteToIndex(fromRoot);
  const ti = noteToIndex(toRoot);
  if (fi === -1 || ti === -1) return 0;
  return wrap(ti - fi);
}

function parseChord(str) {
  // Split on last '/' to find optional bass note
  const slashIdx = str.lastIndexOf('/');
  let main, bass;
  if (slashIdx > 0) {
    const potentialBass = str.slice(slashIdx + 1);
    if (/^[A-G][#b]?$/.test(potentialBass)) {
      main = str.slice(0, slashIdx);
      bass = potentialBass;
    } else {
      main = str;
      bass = null;
    }
  } else {
    main = str;
    bass = null;
  }
  const rootMatch = main.match(/^([A-G][#b]?)/);
  if (!rootMatch) return null;
  return { root: rootMatch[1], quality: main.slice(rootMatch[1].length), bass };
}

export function transposeChord(chord, semitones, targetKey) {
  if (!semitones) return chord;
  const parsed = parseChord(chord);
  if (!parsed) return chord;
  const rootIdx = noteToIndex(parsed.root);
  if (rootIdx === -1) return chord;
  const useSharps = prefersSharps(targetKey);
  const newRoot = indexToNote(rootIdx + semitones, useSharps);
  let newBass = null;
  if (parsed.bass) {
    const bassIdx = noteToIndex(parsed.bass);
    newBass = bassIdx !== -1 ? indexToNote(bassIdx + semitones, useSharps) : parsed.bass;
  }
  return newRoot + parsed.quality + (newBass ? '/' + newBass : '');
}
