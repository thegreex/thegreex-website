# The Greex – Band Portaal

Besloten gedeelte van de website voor bandleden: songbook met akkoorden en setlists per optreden.

## Structuur

```
band-src/        ← LOKAAL, staat in .gitignore, komt NOOIT in de repo
  songs/         ← één .cho bestand per nummer
  gigs/          ← één .json bestand per optreden
band/            ← gepubliceerd (versleuteld)
  index.html
  app.js
  band.css
  transpose.js
  data.enc.json  ← gegenereerd door build; bevat geen leesbare data
scripts/
  build-band.mjs
  new-song.mjs
tests/
  transpose.test.mjs
```

## Vereisten

- Node.js 18 of hoger
- `npm test` werkt zonder extra installatie (gebruikt ingebouwde Node test-runner)

---

## Een nieuw nummer toevoegen

```bash
npm run new-song highway-to-hell
```

Dit maakt `band-src/songs/highway-to-hell.cho` aan met een sjabloon.

Open het bestand en vul in:
- `{title:}` – naam van het nummer
- `{artist:}` – artiest
- `{key:}` – toon waarin WIJ spelen (bijv. `A`)
- `{x_original_key:}` – originele toon (optioneel)
- `{capo:}` – capopositie (`0` = geen)
- `{tempo:}` – BPM
- `{duration:}` – speelduur in `m:ss`
- `{x_lead:}` – wie zingt (standaard Xander)
- `{x_notes:}` – vrije notities
- `{x_link:}` – link naar origineel (YouTube, Spotify)

Daarna tekst met akkoorden invoeren in ChordPro-formaat:
```
[G]Hier begint de [D]zin, en dan [Em]verder
```

---

## Een nieuw optreden toevoegen

Maak een bestand aan in `band-src/gigs/` met de naam `JJJJ-MM-DD-naam.json`:

```json
{
  "date": "2027-03-15",
  "venue": "Café de Roos, Vlaardingen",
  "name": "Voorjaarsconcert",
  "notes": "Opbouw 19:00, aanvang 21:00",
  "sets": [
    {
      "name": "Set 1",
      "songs": [
        { "song": "midnight-ride" },
        { "song": "highway-to-hell" },
        { "song": "star-shaker", "key": "Bb" }
      ]
    },
    {
      "name": "Set 2",
      "songs": [
        { "song": "midnight-ride", "key": "A" }
      ]
    }
  ]
}
```

Met `"key": "Bb"` speel je dat nummer in die optreden in Bb (akkoorden worden automatisch getransponeerd).

---

## Bouwen en publiceren

### 1. Build (versleutelen)

```bash
npm run build
```

Je wordt gevraagd om het wachtwoord. Of gebruik een omgevingsvariabele:

```bash
BAND_PASSWORD=jouwwachtwoord npm run build
```

Dit schrijft `band/data.enc.json`. Dit bestand is veilig om te committen: het bevat alleen versleutelde data.

### 2. Controleer dat band-src/ niet in de repo zit

```bash
git status
```

`band-src/` mag **niet** in de lijst staan.

### 3. Publiceren naar GitHub Pages

Vraag Claude om een nieuw GitHub-token aan te maken en te pushen. Of handmatig:

```bash
git add band/data.enc.json band/index.html band/app.js band/band.css band/transpose.js
git commit -m "Band: update data"
git push origin main
```

---

## Wachtwoord wijzigen

Verander `BAND_PASSWORD` en run `npm run build` opnieuw. Deel het nieuwe wachtwoord met de bandleden.

---

## Tests draaien

```bash
npm test
```

Dit test de transponeerlogica (25 testcases).

---

## Songbook openen

Ga naar: **https://www.thegreex.nl/band/**

Log in met het gedeelde bandwachtwoord. De sessie blijft actief zolang het tabblad open is.
