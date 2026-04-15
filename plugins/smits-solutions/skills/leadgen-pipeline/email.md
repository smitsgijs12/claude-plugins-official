# Email — Cold emails schrijven

## Input: campagne-context + gekwalificeerde lead data + pitch_angle

## Kernprincipe

Eén specifiek pijnpunt als opener — niet het totaalverhaal. Het volledige systeem is het "en dit komt er gratis bij."

## Email structuur

```
[Aanhef — voornaam als bekend, anders "Beste,"]

[Opening: bedrijfsnaam + 1 scherp herkenbaar pijnpunt uit hun sector]

[Oplossing: wat automatisering concreet oplost — max 2-3 zinnen]

[Bewijs/haakje: tijdsbesparing OF subsidie OF e-facturatie — kies 1]

[CTA: concrete tijden voor gesprek + telefoonnummer]

[Afsluiting]

Groet,
Gijs

—
Gijs Smits
Smits Solutions — n8n automatisering
06-29377440
smitssolutions.nl
```

## Regels

1. Altijd "je/jij", nooit "u" of "jullie"
2. 80-120 woorden (kort genoeg om te lezen, lang genoeg voor waarde)
3. Onderwerpregel: 30-50 tekens, bedrijfsnaam erin, actiegericht
4. Noem bedrijfsnaam in de eerste zin
5. Maximaal 1 sales haakje per mail — niet stapelen
6. Geen valse claims ("3 bedrijven gebruiken dit al")
7. Geen overdrijving ("revolutioneer", "8 uur per week besparen")
8. Altijd opt-out zin onderaan: "Geen interesse? Laat het weten, dan hoor je niks meer van me."
9. Als contactpersoon onbekend of generiek (info@): gebruik "Beste," — niet gokken

## Pijnpunten per sector

Genereer pijnpunten dynamisch op basis van de sector uit campagne-context. Hier zijn voorbeelden voor veelvoorkomende sectoren:

### Bouw & installatie
- Werkbonnen op papier → facturen handmatig overtikken
- Bevestigingen per WhatsApp/telefoon vergeten
- Bonnetjes kwijtraken, boekhouding achter
- Betalingen niet opvolgen, geld blijft liggen
- Haakje: personeelstekort (80%+ van bouwbedrijven)

### Technische dienstverlening
- Offertes handmatig opmaken, opvolging vergeten
- Planning via telefoon en WhatsApp
- Geen centraal klantoverzicht
- Haakje: 80% bereid te investeren in digitale workflows

### Groothandel
- Orderverwerking handmatig invoeren
- Voorraadstatus niet real-time
- Facturen per stuk opmaken en mailen
- Haakje: e-facturatie EU-verplichting 2028

### Schoonmaak & facilitair
- Roosters handmatig maken en wijzigen
- Urenregistratie op papier
- Klachten en meldingen niet centraal
- Haakje: personeelstekort + groei

### Hoveniers & groenvoorziening
- Seizoenspieken in administratie
- Offertes niet opvolgen
- Werkbonnen → facturen achterstand
- Haakje: subsidie (Datamaturiteit MKB)

### Overige sectoren
Gebruik de pitch_angle uit qualify.md en genereer 2-3 sector-relevante pijnpunten op basis van de diensten en het bedrijfsprofiel.

## Spoor A — Portfolio email

Framing: "Ik ben mijn portfolio aan het uitbreiden en selecteer twee bedrijven in [sector/regio]."

```
Beste [naam],

[Bedrijfsnaam] — [1 herkenbaar pijnpunt].

Ik bouw automatiseringen voor [sector]-bedrijven en ben mijn portfolio
aan het uitbreiden. Ik selecteer twee bedrijven in [regio] waarvoor ik
het hele traject verzorg — van [proces A] tot [proces B] — zonder
projectkosten. Je betaalt alleen hosting (vanaf €75/mnd).

In ruil vraag ik een korte testimonial als je tevreden bent.

Kan ik dit in 15 minuten toelichten? [dag] [tijd] of [dag] [tijd]?
Je bereikt me op 06-29377440.

Groet,
Gijs
```

## Spoor B — Standaard email

```
Beste [naam],

[Bedrijfsnaam] — [1 scherp pijnpunt als vraag of herkenning].

[Wat automatisering concreet verandert — 1-2 zinnen, focus op hun situatie]

[1 haakje: tijdsbesparing / subsidie / e-facturatie]

Mag ik dit in 30 minuten doorlopen? [dag] [tijd] of [dag] [tijd]?
Je bereikt me op 06-29377440.

Groet,
Gijs
```

## Onderwerpregel voorbeelden

- `[Bedrijfsnaam]: facturen nog handmatig?`
- `[Bedrijfsnaam]: van werkbon naar factuur — automatisch`
- `[Bedrijfsnaam]: 5 uur per maand minder admin?`
- `[Bedrijfsnaam]: klaar voor e-facturatie?`
- `[Bedrijfsnaam]: portfolio-selectie [sector] [regio]`

## Wat NIET te zeggen

- ❌ "3 lokale bedrijven gebruiken dit" (niet bewezen)
- ❌ "8 uur per week besparen" (te hoog)
- ❌ "Revolutioneer je bedrijf" (te salesy)
- ❌ Alleen facturatie noemen (toon breder systeem)
- ❌ Technische termen (n8n, API, webhook)

## Wat WEL te zeggen

- ✅ "Van werkbon tot betaling automatisch"
- ✅ "Geen handmatig bevestigen, factureren, of opvolgen"
- ✅ "5-10 uur per maand besparen op administratie"
- ✅ "Draait op de achtergrond, geen nieuwe software"
- ✅ "Bonnetjes scannen → boekhouding klaar"
- ✅ Subsidiemogelijkheden als drempelverlager

## Goedkeuring

Toon de email aan Gijs met:
```
📧 [Bedrijfsnaam] — [Label] — Spoor [A/B]
Onderwerp: [onderwerp]

[email body]

---
Versturen? (y = ja / n = nee / e = edit / s = skip)
```

Wacht op antwoord. Bij `e`: vraag wat er moet veranderen. Bij `n` of `s`: ga naar volgende lead.
