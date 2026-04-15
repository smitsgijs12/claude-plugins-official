# Scout — Leads zoeken

## Input: campagne-context

Deze stap gebruikt de sector, subsectoren, regio en bedrijfsgrootte uit de campagne-context (zie `SKILL.md`). Alle zoektermen, filters en verwachtingen worden daarop gebaseerd.

## Google Maps scan

Open Chrome → Google Maps.

### Zoektermen genereren

Bouw zoektermen op basis van campagne-context. Combineer sector + regio:
- `[sector] [stad]` (bijv. "installatiebedrijf Eindhoven")
- `[subsector] [stad]` (bijv. "warmtepomp installateur Eindhoven")
- `[sector] [regio]` (bijv. "loodgieter Noord-Brabant")

Varieer op synoniemen: "installateur", "installatiebedrijf", "technisch installatiebedrijf", etc.

### Per bedrijf vastleggen

| Veld | Bron |
|------|------|
| `bedrijfsnaam` | Maps listing |
| `website` | Maps listing |
| `telefoon` | Maps listing |
| `adres` | Maps listing |
| `stad` | Maps listing |
| `reviews_aantal` | Maps listing |
| `reviews_score` | Maps listing |
| `categorie` | Maps listing |
| `sector` | Uit campagne-context |
| `regio` | Uit campagne-context |

### Website bezoeken

Als website beschikbaar:
1. Open de website
2. Zoek naar: emailadres, contactpersoon/eigenaar naam, diensten, zichtbare software/tools
3. Check: is er online booking? Zichtbaar CRM? Modern of verouderd design?
4. Leg vast: `email`, `contactpersoon`, `diensten`, `website_kwaliteit`, `software_zichtbaar`, `online_booking`

### Email zoeken (als niet op website)

Probeer in deze volgorde:
1. Contact-pagina van de website
2. Footer van de website
3. Privacy/algemene voorwaarden pagina
4. Google: `"[bedrijfsnaam]" email @`
5. KvK/LinkedIn (als beschikbaar)

Geen email gevonden? Log als `email: NIET_GEVONDEN`. Niet gokken.

## Deduplicatie

Voor je een lead toevoegt aan de Sheet, check:
- Bestaat `bedrijfsnaam` al? → SKIP
- Bestaat `website` al? → SKIP
- Bestaat `email` al? → SKIP
- Bestaat `telefoon` al? → SKIP

## Bedrijven zonder website

Bedrijven zonder website zijn potentieel extra waardevol — ze hebben waarschijnlijk meer behoefte aan digitalisering. Log ze apart met `website: GEEN`. Ze kunnen later via telefoon of brief benaderd worden.

## Output

Log elke lead direct in de Google Sheet met status: `Nieuw`. Vul `sector` en `regio` in uit campagne-context.

## Afsluiting

Meld aan Gijs:
```
[X] bedrijven gevonden in [regio] ([sector]).
- [Y] met email
- [Z] zonder website (high value)
- [W] overgeslagen (duplicaat)
Wil je dat ik ze kwalificeer?
```
