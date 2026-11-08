#!/usr/bin/env node
// Maakt een nieuw ChordPro-sjabloon aan in band-src/songs/
// Gebruik: npm run new-song <slug>
// Voorbeeld: npm run new-song highway-to-hell

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const slug = process.argv[2];
if (!slug) {
  console.error('Gebruik: npm run new-song <slug>');
  console.error('Voorbeeld: npm run new-song highway-to-hell');
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error('Slug mag alleen kleine letters, cijfers en koppeltekens bevatten.');
  process.exit(1);
}

const dir = 'band-src/songs';
mkdirSync(dir, { recursive: true });
const file = join(dir, `${slug}.cho`);
if (existsSync(file)) {
  console.error(`Bestaat al: ${file}`);
  process.exit(1);
}

const template = `{title: Vul titel in}
{artist: Artiest}
{key: G}
{x_original_key: G}
{capo: 0}
{tempo: 120}
{duration: 3:30}
{x_lead: Xander}
{x_notes: }
{x_link: https://}

{start_of_verse: Couplet 1}
[G]Eerste [C]regel van het [D]couplet
[G]Tweede [C]regel hier
{end_of_verse}

{start_of_chorus: Refrein}
[C]Eerste [G]regel van het [D]refrein
[C]Tweede [G]regel
{end_of_chorus}

{start_of_verse: Couplet 2}
[G]Eerste [C]regel couplet [D]twee
[G]Tweede [C]regel hier
{end_of_verse}

{start_of_chorus: Refrein}
[C]Eerste [G]regel van het [D]refrein
[C]Tweede [G]regel
{end_of_chorus}
`;

writeFileSync(file, template, 'utf8');
console.log(`✓ Aangemaakt: ${file}`);
