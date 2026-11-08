import { transposeChord, transposeKey, semitonesBetween } from './transpose.js';

// ===== CRYPTO =====

async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new Uint8Array(salt), hash: 'SHA-256', iterations },
    km,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
}

async function decryptData(envelope, key) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(envelope.iv) },
    key,
    new Uint8Array(envelope.data)
  );
  return JSON.parse(new TextDecoder().decode(pt));
}

async function saveKey(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  sessionStorage.setItem('band_key', btoa(String.fromCharCode(...new Uint8Array(raw))));
}

async function loadSavedKey() {
  const stored = sessionStorage.getItem('band_key');
  if (!stored) return null;
  try {
    const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  } catch { return null; }
}

// ===== CHORDPRO PARSER =====

function parseDirectives(cho) {
  const meta = {};
  for (const line of cho.split('\n')) {
    const m = line.match(/^\{\s*(\w+)\s*(?::\s*(.*?))?\s*\}$/);
    if (!m) continue;
    meta[m[1].toLowerCase()] = m[2] !== undefined ? m[2].trim() : true;
  }
  return meta;
}

function parseChordLine(line) {
  const segments = [];
  const firstBracket = line.indexOf('[');
  if (firstBracket === -1) return [{ chord: '', text: line }];
  if (firstBracket > 0) segments.push({ chord: '', text: line.slice(0, firstBracket) });
  const re = /\[([^\]]*)\]([^\[]*)/g;
  re.lastIndex = firstBracket;
  let m;
  while ((m = re.exec(line)) !== null) segments.push({ chord: m[1], text: m[2] });
  return segments;
}

function isStartSection(d) {
  return ['start_of_verse','sov','start_of_chorus','soc','start_of_bridge'].includes(d);
}
function isEndSection(d) {
  return ['end_of_verse','eov','end_of_chorus','eoc','end_of_bridge'].includes(d);
}
function sectionTypeFrom(d) {
  if (d.includes('verse')  || d === 'sov') return 'verse';
  if (d.includes('chorus') || d === 'soc') return 'chorus';
  if (d.includes('bridge'))                return 'bridge';
  return 'verse';
}

function parseSong(cho, semitones) {
  const lines = cho.split('\n');
  const meta = parseDirectives(cho);
  const sections = [];
  let cur = null;
  const originalKey = meta.key || 'C';
  const targetKey   = transposeKey(originalKey, semitones);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const dm = line.match(/^\{\s*(\w+)\s*(?::\s*(.*?))?\s*\}$/);
    if (dm) {
      const d = dm[1].toLowerCase();
      const v = (dm[2] || '').trim();
      if (isStartSection(d)) {
        cur = { type: sectionTypeFrom(d), label: v, lines: [] };
        sections.push(cur);
      } else if (isEndSection(d)) {
        cur = null;
      } else if (d === 'comment' || d === 'c') {
        cur = { type: 'comment', label: v, lines: [] };
        sections.push(cur);
      }
      continue;
    }
    if (!cur) continue;
    if (line === '') { cur.lines.push({ type: 'blank' }); continue; }
    if (line.includes('[')) {
      cur.lines.push({ type: 'chord', segments: parseChordLine(line) });
    } else {
      cur.lines.push({ type: 'text', text: line });
    }
  }
  return { meta, sections, originalKey, targetKey, semitones };
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderChordLine(segments, semitones, targetKey) {
  if (segments.length === 1 && !segments[0].chord) {
    return `<span class="ly-plain">${escHtml(segments[0].text)}</span>`;
  }
  const parts = segments.map(({ chord, text }) => {
    const ch = chord ? transposeChord(chord, semitones, targetKey) : '';
    return `<span class="cw"><span class="ch">${escHtml(ch)}</span><span class="ly">${escHtml(text) || ' '}</span></span>`;
  });
  return `<span class="line-chords">${parts.join('')}</span>`;
}

function sectionLabel(type, label) {
  if (label) return label;
  if (type === 'verse')   return 'Couplet';
  if (type === 'chorus')  return 'Refrein';
  if (type === 'bridge')  return 'Bridge';
  return '';
}

function renderSong({ sections, semitones, targetKey }) {
  let html = '';
  for (const sec of sections) {
    if (sec.type === 'comment') {
      html += `<div class="sec-comment">${escHtml(sec.label)}</div>`;
      for (const line of sec.lines) {
        if (line.type === 'blank') { html += '<div class="ly-blank"></div>'; continue; }
        html += `<div class="song-line">${line.type === 'chord'
          ? renderChordLine(line.segments, semitones, targetKey)
          : `<span class="ly-plain">${escHtml(line.text)}</span>`}</div>`;
      }
      continue;
    }
    html += `<div class="song-section song-${escHtml(sec.type)}">`;
    const lbl = sectionLabel(sec.type, sec.label);
    if (lbl) html += `<div class="sec-label">${escHtml(lbl)}</div>`;
    for (const line of sec.lines) {
      if (line.type === 'blank') { html += '<div class="ly-blank"></div>'; continue; }
      html += `<div class="song-line">${line.type === 'chord'
        ? renderChordLine(line.segments, semitones, targetKey)
        : `<span class="ly-plain">${escHtml(line.text)}</span>`}</div>`;
    }
    html += '</div>';
  }
  return html;
}

// ===== UTILS =====

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  const months = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function parseDuration(s) {
  if (!s) return 0;
  const m = String(s).match(/^(\d+):(\d+)$/);
  return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
}

function formatDuration(secs) {
  if (!secs) return '';
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

// ===== STATE =====

let appData = null;

// ===== VIEWS =====

function viewSongs() {
  const rows = Object.entries(appData.songs)
    .map(([slug, cho]) => {
      const m = parseDirectives(cho);
      return { slug, title: m.title || slug, artist: m.artist || '', key: m.key || '', dur: m.duration || '' };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'nl'))
    .map(s => `<tr>
      <td><a href="#song/${escHtml(s.slug)}" class="song-link">${escHtml(s.title)}</a></td>
      <td class="col-artist">${escHtml(s.artist)}</td>
      <td class="col-key"><span class="key-badge">${escHtml(s.key)}</span></td>
      <td class="col-dur">${escHtml(s.dur)}</td>
    </tr>`).join('');

  return `<div class="view-header">
    <h1>Nummers</h1>
    <input type="search" id="songSearch" placeholder="Zoek op titel of artiest…" class="search-input" autocomplete="off">
  </div>
  <table class="song-table" id="songTable">
    <thead><tr><th>Titel</th><th>Artiest</th><th>Toon</th><th>Duur</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function viewSong(slug, semitones) {
  const cho = appData.songs[slug];
  if (!cho) return `<p class="error">Nummer niet gevonden: ${escHtml(slug)}</p>`;
  const parsed = parseSong(cho, semitones);
  const { meta, targetKey } = parsed;
  const offset = semitones > 0 ? `+${semitones}` : semitones < 0 ? `${semitones}` : '';

  return `<div class="song-header screen-only">
    <a href="#songs" class="back-link">← Nummers</a>
  </div>
  <div class="song-header-print">
    <div class="song-title-line">
      <span class="song-title-h">${escHtml(meta.title || slug)}</span>
      <span class="song-artist-h">${escHtml(meta.artist || '')}</span>
    </div>
    <div class="song-meta-row">
      <span class="key-current">Toon: <strong>${escHtml(targetKey)}</strong>${offset ? ` <span class="offset">(${offset})</span>` : ''}</span>
      ${meta.capo && meta.capo !== '0' ? `<span class="meta-item">Capo ${escHtml(meta.capo)}</span>` : ''}
      ${meta.tempo ? `<span class="meta-item">♩ ${escHtml(meta.tempo)} BPM</span>` : ''}
      ${meta.duration ? `<span class="meta-item">⏱ ${escHtml(meta.duration)}</span>` : ''}
      ${meta.x_lead ? `<span class="meta-item">Zang: ${escHtml(meta.x_lead)}</span>` : ''}
      ${meta.x_original_key && meta.x_original_key !== meta.key ? `<span class="meta-item muted">Origineel: ${escHtml(meta.x_original_key)}</span>` : ''}
    </div>
    ${meta.x_notes ? `<div class="song-notes">${escHtml(meta.x_notes)}</div>` : ''}
  </div>
  <div class="transpose-controls screen-only">
    <button class="btn-transpose" onclick="app.transpose('${escHtml(slug)}', ${semitones - 1})">−</button>
    <span class="tc-key">${escHtml(targetKey)}</span>
    <button class="btn-transpose" onclick="app.transpose('${escHtml(slug)}', ${semitones + 1})">+</button>
    ${semitones !== 0 ? `<button class="btn-reset" onclick="app.transpose('${escHtml(slug)}', 0)">Reset</button>` : ''}
    <button class="btn-print" onclick="window.print()">🖨 Print</button>
    ${meta.x_link ? `<a href="${escHtml(meta.x_link)}" target="_blank" class="btn-link">Origineel →</a>` : ''}
  </div>
  <div class="song-body">${renderSong(parsed)}</div>`;
}

function viewGigs() {
  const now = new Date().toISOString().slice(0, 10);
  const upcoming = appData.gigs.filter(g => g.date >= now);
  const past     = [...appData.gigs.filter(g => g.date <  now)].reverse();

  function card(g) {
    const id = `${g.date}-${slugify(g.name)}`;
    const songsCount = (g.sets || []).reduce((n, s) => n + s.songs.length, 0);
    return `<a href="#gig/${escHtml(id)}" class="gig-card">
      <span class="gig-date">${formatDate(g.date)}</span>
      <span class="gig-name">${escHtml(g.name)}</span>
      <span class="gig-venue">${escHtml(g.venue)}</span>
      <span class="gig-count">${songsCount} nummers</span>
    </a>`;
  }

  const upHtml  = upcoming.length ? upcoming.map(card).join('') : '<p class="muted-p">Geen aankomende optredens</p>';
  const pastHtml = past.length ? `<h2 class="list-h2">Vorige optredens</h2>${past.map(card).join('')}` : '';

  return `<div class="view-header"><h1>Optredens</h1></div>
  <div class="gig-list">${upHtml}${pastHtml}</div>`;
}

function viewGig(gigId) {
  const datePart = gigId.slice(0, 10);
  const gig = appData.gigs.find(g => g.date === datePart && slugify(g.name) === gigId.slice(11));
  if (!gig) return `<p class="error">Optreden niet gevonden.</p>`;

  let totalSecs = 0;
  const setsHtml = (gig.sets || []).map((set, si) => {
    let setSecs = 0;
    const rows = set.songs.map((item, idx) => {
      const cho  = appData.songs[item.song];
      const meta = cho ? parseDirectives(cho) : {};
      const displayKey = item.key || meta.key || '';
      const secs = parseDuration(meta.duration);
      setSecs += secs; totalSecs += secs;
      return `<div class="setlist-row">
        <span class="set-num">${idx + 1}</span>
        <a class="set-title" href="#song/${escHtml(item.song)}">${escHtml(meta.title || item.song)}</a>
        <span class="set-artist">${escHtml(meta.artist || '')}</span>
        <span class="set-key"><span class="key-badge">${escHtml(displayKey)}</span></span>
        <span class="set-dur">${formatDuration(secs)}</span>
      </div>`;
    }).join('');
    const pause = si < gig.sets.length - 1 ? '<div class="set-pause">— PAUZE —</div>' : '';
    return `<div class="set-block">
      <div class="set-head">
        <span class="set-name">${escHtml(set.name)}</span>
        <span class="set-total">${formatDuration(setSecs)}</span>
      </div>
      ${rows}
    </div>${pause}`;
  }).join('');

  const id = `${gig.date}-${slugify(gig.name)}`;
  return `<div class="view-header">
    <a href="#gigs" class="back-link">← Optredens</a>
    <h1>${escHtml(gig.name)}</h1>
    <div class="gig-info">
      <span>${formatDate(gig.date)}</span>
      <span>${escHtml(gig.venue)}</span>
      <span class="muted">Totaal: ${formatDuration(totalSecs)}</span>
    </div>
    ${gig.notes ? `<div class="gig-notes">${escHtml(gig.notes)}</div>` : ''}
    <div class="gig-actions screen-only">
      <button class="btn-secondary-sm" onclick="app.printGig('${escHtml(id)}')">🖨 Print optreden</button>
    </div>
  </div>
  <div class="setlist">${setsHtml}</div>`;
}

// ===== GIG PRINT =====

window.app = {
  transpose(slug, semitones) {
    window.location.hash = `song/${slug}?t=${semitones}`;
  },

  printGig(gigId) {
    const datePart = gigId.slice(0, 10);
    const gig = appData.gigs.find(g => g.date === datePart && slugify(g.name) === gigId.slice(11));
    if (!gig) return;

    let html = `<div class="pg-title">${escHtml(gig.name)}</div>`;
    html += `<div class="pg-meta">${formatDate(gig.date)} · ${escHtml(gig.venue)}</div>`;
    if (gig.notes) html += `<div class="pg-notes">${escHtml(gig.notes)}</div>`;

    // Setlist section
    let totalSecs = 0;
    (gig.sets || []).forEach((set, si) => {
      let setSecs = 0;
      html += `<div class="pg-set-name">${escHtml(set.name)}</div>`;
      set.songs.forEach((item, idx) => {
        const cho  = appData.songs[item.song];
        const meta = cho ? parseDirectives(cho) : {};
        const displayKey = item.key || meta.key || '';
        const secs = parseDuration(meta.duration);
        setSecs += secs; totalSecs += secs;
        html += `<div class="pg-row">
          <span class="pg-num">${idx + 1}</span>
          <span class="pg-stitle">${escHtml(meta.title || item.song)}</span>
          <span class="pg-key">${escHtml(displayKey)}</span>
          <span class="pg-dur">${formatDuration(secs)}</span>
        </div>`;
      });
      if (si < gig.sets.length - 1) html += `<div class="pg-pause">— PAUZE —</div>`;
    });
    html += `<div class="pg-total">Totale speeltijd: ${formatDuration(totalSecs)}</div>`;

    // Songs, one per page
    (gig.sets || []).forEach(set => {
      set.songs.forEach(item => {
        const cho = appData.songs[item.song];
        if (!cho) return;
        const meta = parseDirectives(cho);
        const songKey = meta.key || 'C';
        const gigKey  = item.key;
        const semiT   = gigKey ? semitonesBetween(songKey, gigKey) : 0;
        const parsed  = parseSong(cho, semiT);

        html += `<div class="pg-song-page">`;
        html += `<div class="pg-song-title">${escHtml(meta.title || item.song)}</div>`;
        html += `<div class="pg-song-meta">`;
        if (meta.artist) html += `<span>${escHtml(meta.artist)}</span>`;
        html += `<span>Toon: ${escHtml(parsed.targetKey)}</span>`;
        if (meta.capo && meta.capo !== '0') html += `<span>Capo: ${escHtml(meta.capo)}</span>`;
        if (meta.tempo) html += `<span>♩ ${escHtml(meta.tempo)} BPM</span>`;
        html += `</div>${renderSong(parsed)}</div>`;
      });
    });

    const pc = document.getElementById('print-container');
    pc.innerHTML = html;
    document.body.dataset.printMode = 'gig';
    window.print();
    setTimeout(() => { pc.innerHTML = ''; delete document.body.dataset.printMode; }, 1000);
  }
};

// ===== ROUTER =====

function getRoute() {
  const hash = window.location.hash.slice(1) || 'songs';
  const [pathStr, queryStr] = hash.split('?');
  const parts = pathStr.split('/');
  const params = {};
  if (queryStr) queryStr.split('&').forEach(p => { const [k,v] = p.split('='); params[k] = v; });
  return { view: parts[0] || 'songs', id: parts.slice(1).join('/'), params };
}

function render() {
  const { view, id, params } = getRoute();
  const content = document.getElementById('app-content');

  document.querySelectorAll('.band-nav a[data-view]').forEach(a => {
    a.classList.toggle('active', a.dataset.view === view);
  });

  if      (view === 'songs') content.innerHTML = viewSongs();
  else if (view === 'song')  content.innerHTML = viewSong(id, parseInt(params.t || '0', 10));
  else if (view === 'gigs')  content.innerHTML = viewGigs();
  else if (view === 'gig')   content.innerHTML = viewGig(id);
  else                       content.innerHTML = viewSongs();

  if (view === 'songs') {
    const input = document.getElementById('songSearch');
    if (input) input.addEventListener('input', () => {
      const q = input.value.toLowerCase();
      document.querySelectorAll('#songTable tbody tr').forEach(r => {
        r.hidden = !r.textContent.toLowerCase().includes(q);
      });
    });
  }

  window.scrollTo(0, 0);
}

// ===== BOOTSTRAP =====

async function tryDecrypt(key, envelope) {
  try { return await decryptData(envelope, key); } catch { return null; }
}

async function boot() {
  const loginScreen = document.getElementById('login-screen');
  const appScreen   = document.getElementById('app-screen');
  const errorEl     = document.getElementById('login-error');

  let envelope;
  try {
    const r = await fetch('data.enc.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    envelope = await r.json();
  } catch (e) {
    loginScreen.hidden = false;
    errorEl.textContent = `Kon data.enc.json niet laden (${e.message}). Run eerst: npm run build`;
    return;
  }

  const savedKey = await loadSavedKey();
  if (savedKey) {
    const data = await tryDecrypt(savedKey, envelope);
    if (data) { appData = data; showApp(loginScreen, appScreen); return; }
  }

  loginScreen.hidden = false;

  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = document.getElementById('password-input').value;
    errorEl.textContent = '';
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Even wachten…';
    try {
      const key  = await deriveKey(pw, envelope.salt, envelope.iterations);
      const data = await tryDecrypt(key, envelope);
      if (!data) { errorEl.textContent = 'Verkeerd wachtwoord.'; btn.disabled = false; btn.textContent = 'Inloggen'; return; }
      await saveKey(key);
      appData = data;
      showApp(loginScreen, appScreen);
    } catch (err) {
      errorEl.textContent = 'Fout: ' + err.message;
      btn.disabled = false; btn.textContent = 'Inloggen';
    }
  });
}

function showApp(loginScreen, appScreen) {
  loginScreen.hidden = true;
  appScreen.hidden   = false;
  window.addEventListener('hashchange', render);
  render();
}

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('band_key');
  appData = null;
  window.location.hash = '';
  window.location.reload();
});

boot();
