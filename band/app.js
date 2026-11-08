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
    ['decrypt', 'encrypt']
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
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['decrypt', 'encrypt']);
  } catch { return null; }
}

async function reEncrypt(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  const encKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    encKey,
    new TextEncoder().encode(JSON.stringify(appData))
  );
  return {
    v: 1,
    iterations: appEnvelope.iterations,
    salt: appEnvelope.salt,
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(ct))
  };
}

async function pushToGitHub(token, envelope) {
  const url = 'https://api.github.com/repos/thegreex/thegreex-website/contents/band/data.enc.json';
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
  const getResp = await fetch(url, { headers });
  let sha;
  if (getResp.ok) {
    sha = (await getResp.json()).sha;
  } else if (getResp.status !== 404) {
    const e = await getResp.json().catch(() => ({}));
    throw new Error(e.message || `GitHub fout ${getResp.status}`);
  }
  const content = btoa(JSON.stringify(envelope));
  const body = {
    message: 'Band: data bijgewerkt via portaal',
    content,
    committer: { name: 'The Greex Band', email: 'thegreexband@gmail.com' }
  };
  if (sha) body.sha = sha;
  const putResp = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putResp.ok) {
    const e = await putResp.json().catch(() => ({}));
    throw new Error(e.message || `GitHub fout ${putResp.status}`);
  }
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
  return { meta, sections, originalKey, targetKey, semitones, rawCho: cho };
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
    return `<span class="cw"><span class="ch">${escHtml(ch)}</span><span class="ly">${escHtml(text) || '\u00a0'}</span></span>`;
  });
  return `<span class="line-chords">${parts.join('')}</span>`;
}

function sectionLabel(type, label) {
  if (label) return label;
  if (type === 'verse')  return 'Couplet';
  if (type === 'chorus') return 'Refrein';
  if (type === 'bridge') return 'Bridge';
  return '';
}

function renderSong({ sections, semitones, targetKey, rawCho }) {
  if (sections.length === 0) {
    const lines = rawCho.split('\n').filter(l => !l.match(/^\{.*\}$/) && l.trim());
    return `<div class="fallback-warning">⚠ Geen secties gevonden — controleer de ChordPro syntax (zijn {start_of_verse} en {end_of_verse} aanwezig?)</div>
    <div class="song-body fallback-body">${lines.map(l => `<div class="song-line"><span class="ly-plain">${escHtml(l)}</span></div>`).join('')}</div>`;
  }
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

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = type === 'error' ? 'msg-error' : 'msg-ok';
}

// ===== STATE =====

let appData     = null;
let appEnvelope = null;

// ===== VIEWS – SONGS =====

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

// ===== VIEWS – GIGS =====

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

  const upHtml   = upcoming.length ? upcoming.map(card).join('') : '<p class="muted-p">Geen aankomende optredens</p>';
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
      </div>${rows}
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

// ===== VIEWS – ADMIN =====

function viewAdmin() {
  const songs = Object.entries(appData.songs)
    .map(([slug, cho]) => {
      const m = parseDirectives(cho);
      return { slug, title: m.title || slug, artist: m.artist || '', key: m.key || '' };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'nl'));

  const songRows = songs.map(s => `<tr>
    <td>${escHtml(s.title)}</td>
    <td class="col-artist">${escHtml(s.artist)}</td>
    <td class="col-key"><span class="key-badge">${escHtml(s.key)}</span></td>
    <td class="col-actions">
      <a href="#edit-song/${escHtml(s.slug)}" class="btn-action">Bewerk</a>
      <button class="btn-action btn-danger" onclick="app.confirmDeleteSong('${escHtml(s.slug)}','${escHtml(s.title).replace(/'/g,"\\'")}')">Verwijder</button>
    </td>
  </tr>`).join('');

  const gigRows = [...appData.gigs].sort((a, b) => b.date.localeCompare(a.date)).map(g => {
    const id = `${g.date}-${slugify(g.name)}`;
    return `<tr>
      <td>${formatDate(g.date)}</td>
      <td>${escHtml(g.name)}</td>
      <td class="col-artist">${escHtml(g.venue)}</td>
      <td class="col-actions">
        <a href="#edit-gig/${escHtml(id)}" class="btn-action">Bewerk</a>
        <button class="btn-action btn-danger" onclick="app.confirmDeleteGig('${escHtml(id)}','${escHtml(g.name).replace(/'/g,"\\'")}')">Verwijder</button>
      </td>
    </tr>`;
  }).join('');

  return `<div class="view-header"><h1>Beheer</h1></div>

  <div class="admin-section">
    <div class="admin-section-head">
      <h2 class="admin-h2">Nummers</h2>
      <a href="#new-song" class="btn-secondary-sm">+ Nieuw nummer</a>
    </div>
    <table class="song-table">
      <thead><tr><th>Titel</th><th>Artiest</th><th>Toon</th><th></th></tr></thead>
      <tbody>${songRows}</tbody>
    </table>
  </div>

  <div class="admin-section">
    <div class="admin-section-head">
      <h2 class="admin-h2">Optredens</h2>
      <a href="#new-gig" class="btn-secondary-sm">+ Nieuw optreden</a>
    </div>
    <table class="song-table">
      <thead><tr><th>Datum</th><th>Naam</th><th>Locatie</th><th></th></tr></thead>
      <tbody>${gigRows || '<tr><td colspan="4" class="muted-p">Nog geen optredens</td></tr>'}</tbody>
    </table>
  </div>

  <div class="publish-bar">
    <p id="publish-status" class="msg-ok"></p>
    <button class="btn-publish" onclick="app.showPublish()">🚀 Publiceer naar website</button>
  </div>

  <div id="publish-modal" class="modal-overlay" hidden>
    <div class="modal-box">
      <h2 class="modal-title">Publiceren</h2>
      <p class="modal-info">GitHub token (classic, <code>repo</code> scope) van <a href="https://github.com/settings/tokens" target="_blank">github.com/settings/tokens</a>.</p>
      <input type="password" id="gh-token-input" placeholder="ghp_…" class="login-input" autocomplete="off">
      <p id="publish-error" class="msg-error"></p>
      <div class="modal-btns">
        <button id="publish-btn" class="btn-login" onclick="app.doPublish()">Publiceren</button>
        <button class="btn-cancel" onclick="app.hidePublish()">Annuleren</button>
      </div>
    </div>
  </div>`;
}

function viewEditSong(slug) {
  const cho = appData.songs[slug];
  if (!cho) return `<p class="error">Nummer niet gevonden.</p>`;
  const meta = parseDirectives(cho);
  return `<div class="view-header">
    <a href="#admin" class="back-link">← Beheer</a>
    <h1>${escHtml(meta.title || slug)}</h1>
  </div>
  <div class="editor-wrap">
    <textarea id="song-editor" class="cho-editor" spellcheck="false">${escHtml(cho)}</textarea>
    <div class="editor-actions">
      <button class="btn-login" onclick="app.saveSong('${escHtml(slug)}')">Opslaan</button>
      <a href="#admin" class="btn-cancel-link">Annuleren</a>
    </div>
    <p id="editor-msg"></p>
  </div>`;
}

const NEW_SONG_TEMPLATE = `{title: Vul titel in}
{artist: Artiest}
{key: G}
{x_original_key: G}
{capo: 0}
{tempo: 120}
{duration: 3:30}
{x_lead: Xander}
{x_notes: }
{x_link: }

{start_of_verse: Couplet 1}
[G]Eerste [C]regel van het [D]couplet
[G]Tweede [C]regel hier
{end_of_verse}

{start_of_chorus: Refrein}
[C]Eerste [G]regel van het [D]refrein
[C]Tweede [G]regel
{end_of_chorus}`;

function viewNewSong() {
  return `<div class="view-header">
    <a href="#admin" class="back-link">← Beheer</a>
    <h1>Nieuw nummer</h1>
  </div>
  <div class="editor-wrap">
    <div class="slug-row">
      <label class="slug-label">Slug <span class="slug-hint">(alleen a-z, 0-9 en koppeltekens, bijv. highway-to-hell)</span></label>
      <input type="text" id="new-slug" placeholder="bijv. highway-to-hell" class="slug-input" autocomplete="off">
    </div>
    <textarea id="song-editor" class="cho-editor" spellcheck="false">${escHtml(NEW_SONG_TEMPLATE)}</textarea>
    <div class="editor-actions">
      <button class="btn-login" onclick="app.createSong()">Aanmaken</button>
      <a href="#admin" class="btn-cancel-link">Annuleren</a>
    </div>
    <p id="editor-msg"></p>
  </div>`;
}

function viewEditGig(gigId) {
  const datePart = gigId.slice(0, 10);
  const gig = appData.gigs.find(g => g.date === datePart && slugify(g.name) === gigId.slice(11));
  if (!gig) return `<p class="error">Optreden niet gevonden.</p>`;
  return gigEditorHtml(gig, gigId);
}

function viewNewGig() {
  return gigEditorHtml(null, null);
}

function gigEditorHtml(gig, gigId) {
  const isNew = !gig;
  const today = new Date().toISOString().slice(0, 10);
  const setsHtml = (gig?.sets || [{ name: 'Set 1', songs: [] }]).map((set, i) => setBlockHtml(i, set)).join('');

  return `<div class="view-header">
    <a href="#admin" class="back-link">← Beheer</a>
    <h1>${isNew ? 'Nieuw optreden' : escHtml(gig.name)}</h1>
  </div>
  <div class="editor-wrap" id="gig-editor-wrap">
    <div class="gig-fields">
      <label class="field-label">Datum<input type="date" id="gig-date" class="field-input" value="${gig?.date || today}"></label>
      <label class="field-label">Naam<input type="text" id="gig-name" class="field-input" placeholder="Kerstfeest" value="${escHtml(gig?.name || '')}"></label>
      <label class="field-label">Locatie<input type="text" id="gig-venue" class="field-input" placeholder="Café de Roos, Vlaardingen" value="${escHtml(gig?.venue || '')}"></label>
      <label class="field-label">Notities<input type="text" id="gig-notes" class="field-input" placeholder="Opbouw 19:00" value="${escHtml(gig?.notes || '')}"></label>
    </div>
    <div id="sets-container">${setsHtml}</div>
    <button class="btn-secondary-sm add-set-btn" onclick="app.addSet()">+ Set toevoegen</button>
    <div class="editor-actions">
      <button class="btn-login" onclick="${isNew ? 'app.createGig()' : `app.saveGig('${escHtml(gigId)}')`}">${isNew ? 'Aanmaken' : 'Opslaan'}</button>
      <a href="#admin" class="btn-cancel-link">Annuleren</a>
    </div>
    <p id="editor-msg"></p>
  </div>`;
}

function songPickerOptions() {
  return Object.entries(appData.songs)
    .map(([slug, cho]) => {
      const m = parseDirectives(cho);
      const label = [m.title || slug, m.artist ? `— ${m.artist}` : '', m.key ? `(${m.key})` : '', m.duration ? m.duration : ''].filter(Boolean).join(' ');
      return `<option value="${escHtml(slug)}">${escHtml(label)}</option>`;
    })
    .sort()
    .join('');
}

function songRowHtml(slug, keyOverride) {
  const cho  = appData.songs[slug] || '';
  const meta = parseDirectives(cho);
  const defaultKey = meta.key || '';
  const displayKey = keyOverride || defaultKey;
  const dur  = meta.duration || '';
  return `<div class="set-song-row" data-slug="${escHtml(slug)}" data-default-key="${escHtml(defaultKey)}">
    <div class="ssrow-move">
      <button class="btn-move" onclick="app.moveSong(this,-1)" title="Omhoog">↑</button>
      <button class="btn-move" onclick="app.moveSong(this,1)"  title="Omlaag">↓</button>
    </div>
    <span class="ssrow-title">${escHtml(meta.title || slug)}</span>
    <span class="ssrow-artist">${escHtml(meta.artist || '')}</span>
    <span class="ssrow-key">
      <input type="text" class="key-override-input" value="${escHtml(displayKey)}" placeholder="${escHtml(defaultKey) || '—'}" title="Toon (leeg = standaard)">
    </span>
    <span class="ssrow-dur">${escHtml(dur)}</span>
    <button class="btn-remove-song" onclick="this.closest('.set-song-row').remove()" title="Verwijder">×</button>
  </div>`;
}

function setBlockHtml(i, set) {
  const songRows = (set?.songs || []).map(s => songRowHtml(s.song, s.key || '')).join('');
  return `<div class="set-editor-block">
    <div class="set-editor-head">
      <label class="slug-label">Set naam</label>
      <input type="text" class="set-name-input field-input" value="${escHtml(set?.name || `Set ${i + 1}`)}" placeholder="Set ${i + 1}">
      <button class="btn-action btn-danger" onclick="this.closest('.set-editor-block').remove()">Verwijder set</button>
    </div>
    <div class="set-songs-list">${songRows}</div>
    <div class="set-add-row">
      <select class="song-picker field-input">
        <option value="">— Kies een nummer —</option>
        ${songPickerOptions()}
      </select>
      <button class="btn-secondary-sm" onclick="app.addSongToSet(this)">+ Toevoegen</button>
    </div>
  </div>`;
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
    (gig.sets || []).forEach(set => {
      set.songs.forEach(item => {
        const cho = appData.songs[item.song];
        if (!cho) return;
        const meta = parseDirectives(cho);
        const semiT = item.key ? semitonesBetween(meta.key || 'C', item.key) : 0;
        const parsed = parseSong(cho, semiT);
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
  },

  // Admin: songs
  saveSong(slug) {
    const content = document.getElementById('song-editor')?.value;
    if (!content?.trim()) { showMsg('editor-msg', 'Inhoud mag niet leeg zijn.', 'error'); return; }
    appData.songs[slug] = content;
    showMsg('editor-msg', '✓ Opgeslagen (nog niet gepubliceerd)', 'ok');
  },

  createSong() {
    const slug = document.getElementById('new-slug')?.value.trim();
    const content = document.getElementById('song-editor')?.value;
    if (!slug) { showMsg('editor-msg', 'Voer een slug in.', 'error'); return; }
    if (!/^[a-z0-9-]+$/.test(slug)) { showMsg('editor-msg', 'Slug mag alleen a-z, 0-9 en - bevatten.', 'error'); return; }
    if (appData.songs[slug]) { showMsg('editor-msg', `Slug "${slug}" bestaat al.`, 'error'); return; }
    if (!content?.trim()) { showMsg('editor-msg', 'Inhoud mag niet leeg zijn.', 'error'); return; }
    appData.songs[slug] = content;
    window.location.hash = `edit-song/${slug}`;
  },

  confirmDeleteSong(slug, title) {
    if (!confirm(`"${title}" verwijderen?`)) return;
    delete appData.songs[slug];
    window.location.hash = 'admin';
  },

  // Admin: gigs
  saveGig(gigId) {
    const data = readGigForm(); if (!data) return;
    const datePart = gigId.slice(0, 10);
    const idx = appData.gigs.findIndex(g => g.date === datePart && slugify(g.name) === gigId.slice(11));
    if (idx === -1) { showMsg('editor-msg', 'Optreden niet gevonden.', 'error'); return; }
    appData.gigs[idx] = data;
    showMsg('editor-msg', '✓ Opgeslagen (nog niet gepubliceerd)', 'ok');
  },

  createGig() {
    const data = readGigForm(); if (!data) return;
    appData.gigs.push(data);
    appData.gigs.sort((a, b) => a.date.localeCompare(b.date));
    window.location.hash = `gig/${data.date}-${slugify(data.name)}`;
  },

  confirmDeleteGig(gigId, name) {
    if (!confirm(`"${name}" verwijderen?`)) return;
    const datePart = gigId.slice(0, 10);
    appData.gigs = appData.gigs.filter(g => !(g.date === datePart && slugify(g.name) === gigId.slice(11)));
    window.location.hash = 'admin';
  },

  addSet() {
    const container = document.getElementById('sets-container');
    if (!container) return;
    const count = container.querySelectorAll('.set-editor-block').length;
    const div = document.createElement('div');
    div.innerHTML = setBlockHtml(count, null);
    container.appendChild(div.firstElementChild);
  },

  addSongToSet(btn) {
    const addRow = btn.closest('.set-add-row');
    const select = addRow.querySelector('.song-picker');
    const slug = select.value;
    if (!slug) return;
    const list = addRow.previousElementSibling;
    const div = document.createElement('div');
    div.innerHTML = songRowHtml(slug, '');
    list.appendChild(div.firstElementChild);
    select.value = '';
  },

  moveSong(btn, dir) {
    const row  = btn.closest('.set-song-row');
    const list = row.parentElement;
    if (dir === -1 && row.previousElementSibling) {
      list.insertBefore(row, row.previousElementSibling);
    } else if (dir === 1 && row.nextElementSibling) {
      list.insertBefore(row.nextElementSibling, row);
    }
  },

  // Publish
  showPublish() {
    const modal = document.getElementById('publish-modal');
    if (modal) modal.hidden = false;
    const stored = sessionStorage.getItem('band_gh_token');
    if (stored) {
      const input = document.getElementById('gh-token-input');
      if (input) input.value = stored;
    }
  },

  hidePublish() {
    const modal = document.getElementById('publish-modal');
    if (modal) modal.hidden = true;
  },

  async doPublish() {
    const token = document.getElementById('gh-token-input')?.value.trim();
    const errEl = document.getElementById('publish-error');
    if (errEl) errEl.textContent = '';
    if (!token) { showMsg('publish-error', 'Voer een GitHub token in.', 'error'); return; }
    sessionStorage.setItem('band_gh_token', token);
    const btn = document.getElementById('publish-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Versleutelen…'; }
    try {
      const key = await loadSavedKey();
      if (!key) throw new Error('Sessie verlopen, log opnieuw in.');
      const newEnvelope = await reEncrypt(key);
      if (btn) btn.textContent = 'Publiceren naar GitHub…';
      await pushToGitHub(token, newEnvelope);
      appEnvelope = newEnvelope;
      app.hidePublish();
      showMsg('publish-status', '✓ Gepubliceerd! Duurt ~1 minuut voor live.', 'ok');
    } catch (e) {
      showMsg('publish-error', 'Fout: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Publiceren'; }
    }
  }
};

function readGigForm() {
  const date  = document.getElementById('gig-date')?.value;
  const name  = document.getElementById('gig-name')?.value.trim();
  const venue = document.getElementById('gig-venue')?.value.trim();
  const notes = document.getElementById('gig-notes')?.value.trim();
  if (!date || !name || !venue) {
    showMsg('editor-msg', 'Datum, naam en locatie zijn verplicht.', 'error');
    return null;
  }
  const sets = [];
  document.querySelectorAll('.set-editor-block').forEach(block => {
    const setName = block.querySelector('.set-name-input')?.value.trim() || 'Set';
    const songs = [...block.querySelectorAll('.set-song-row')].map(row => {
      const slug = row.dataset.slug;
      const defaultKey = row.dataset.defaultKey;
      const keyOverride = row.querySelector('.key-override-input')?.value.trim() || '';
      return keyOverride && keyOverride !== defaultKey ? { song: slug, key: keyOverride } : { song: slug };
    });
    sets.push({ name: setName, songs });
  });
  return { date, venue, name, notes: notes || '', sets };
}

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
    a.classList.toggle('active', a.dataset.view === view || (view.startsWith('edit-') && a.dataset.view === 'admin') || (view === 'new-song' && a.dataset.view === 'admin') || (view === 'new-gig' && a.dataset.view === 'admin'));
  });

  if      (view === 'songs')     content.innerHTML = viewSongs();
  else if (view === 'song')      content.innerHTML = viewSong(id, parseInt(params.t || '0', 10));
  else if (view === 'gigs')      content.innerHTML = viewGigs();
  else if (view === 'gig')       content.innerHTML = viewGig(id);
  else if (view === 'admin')     content.innerHTML = viewAdmin();
  else if (view === 'edit-song') content.innerHTML = viewEditSong(id);
  else if (view === 'new-song')  content.innerHTML = viewNewSong();
  else if (view === 'edit-gig')  content.innerHTML = viewEditGig(id);
  else if (view === 'new-gig')   content.innerHTML = viewNewGig();
  else                           content.innerHTML = viewSongs();

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
    if (data) { appData = data; appEnvelope = envelope; showApp(loginScreen, appScreen); return; }
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
      appData = data; appEnvelope = envelope;
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
  sessionStorage.clear();
  appData = null; appEnvelope = null;
  window.location.hash = '';
  window.location.reload();
});

boot();
