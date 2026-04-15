# Qualify — Leads scoren en kwalificeren

## Input: campagne-context + lead data uit Sheet

## Scoring model (max 10 punten)

### Bedrijfsprofiel (max 4)

| Criterium | Score |
|-----------|-------|
| Binnen target bedrijfsgrootte (campagne-context) | +2 |
| Net onder/boven target grootte | +1 |
| Ver buiten target | 0 |
| Groeisignalen (vacatures, uitbreiding, nieuw pand) | +1 |
| Sector-specifiek sterk signaal* | +1 |

*Bepaal per campagne welk signaal dit is. Voorbeelden:
- Installatie: energietransitie, warmtepompen, zonnepanelen
- Bouw: Wkb-documentatieplicht, BIM-adoptie
- Hoveniers: seizoenspiek, groeiende klantenbase
- Groothandel: e-commerce groei, multi-channel
- Schoonmaak: contractgroei, personeelsplanning

### Automatiseringspotentieel (max 4)

| Criterium | Score |
|-----------|-------|
| Geen online booking/planning | +1 |
| @gmail.com / @hotmail.com email | +1 |
| Geen zichtbare software/tools op website | +1 |
| Handmatig offerteproces ("bel voor offerte") | +1 |

### Pijnsignalen (max 2)

| Criterium | Score |
|-----------|-------|
| Negatieve reviews over bereikbaarheid/snelheid | +1 |
| Verouderde website (pre-2020, oud copyright jaar) | +1 |

### Disqualifiers

| Criterium | Score |
|-----------|-------|
| Onderdeel keten/franchise | -5 |
| Moderne site met booking + CRM-integratie | -3 |
| Zichtbaar groot ERP-systeem (SAP, Navision) | -2 |

## Labels

| Score | Label | Actie |
|-------|-------|-------|
| 7-10 | 🔥 HOT | Email + bellen na 3 dagen |
| 4-6 | 🟡 WARM | Email, afwachten |
| 1-3 | 🔵 COLD | Parkeren |
| ≤ 0 | ❌ SKIP | Niet benaderen |

## Portfolio-check (alleen als spoor A actief)

HOT leads die ook portfolio-kandidaat zijn moeten voldoen aan:
- Binnen target sector uit campagne-context
- 10-30 medewerkers
- Herkenbare naam / sterk lokaal merk
- Minimaal 1 duidelijk automatiseerbaar proces
- Eigenaar/directeur direct bereikbaar (niet via secretariaat)

Markeer als `type: PORTFOLIO`.

## Pitch angle genereren

Genereer per lead een `pitch_angle` op basis van:
1. De sterkste pijnsignalen uit de scoring
2. De sector uit campagne-context
3. De specifieke diensten van het bedrijf
4. Het best passende sales haakje (personeelstekort / subsidie / e-facturatie)

De pitch angle is 1-2 zinnen die het vertrekpunt vormen voor de email.

Voorbeeld: "Groeiend installatiebedrijf met 15 man dat warmtepompen doet maar werkbonnen nog op papier invult en facturen in Word tikt. Haakje: personeelstekort + e-facturatie."

## Lead variabelen — vulgraad

### Altijd beschikbaar
`bedrijfsnaam`, `locatie`, `website`, `diensten`, `software_zichtbaar`, `website_kwaliteit`, `email_type`

### Meestal beschikbaar (80-99%)
- `email` (94%) — info@ = niet direct bij beslisser
- `telefoon` (99%) — voor opvolging, niet in mail
- `geschat_medewerkers` (80%) — 5-10: eigenaar doet admin. 15+: coördinatieproblemen

### Soms beschikbaar (10-35%)
- `contactpersoon` (25%) — voornaam in aanhef als beschikbaar
- `vacatures` (33%) — groei = procesdruk
- `online_booking` (10%) — false = pijnpunt planning

### Na kwalificatie
- `score` (1-10)
- `label` (HOT/WARM/COLD/SKIP)
- `scoring_breakdown`
- `pitch_angle`
- `type` (PORTFOLIO / STANDAARD)

## Output

Update Sheet per lead: `score`, `label`, `pitch_angle`, `type`, `scoring_breakdown`.

Meld aan Gijs:
```
Kwalificatie [sector] [regio] klaar:
- 🔥 HOT: [X] leads
- 🟡 WARM: [Y] leads
- 🔵 COLD: [Z] leads
- ❌ SKIP: [W] leads
- 📋 Portfolio-kandidaten: [P] leads

Top 3 HOT leads:
1. [Bedrijf] — [pitch_angle kort]
2. [Bedrijf] — [pitch_angle kort]
3. [Bedrijf] — [pitch_angle kort]

Wil je dat ik emails schrijf? (portfolio eerst / standaard eerst / specifieke lead)
```
