# Follow-up — Opvolgsequentie

## Input: leads met status `Verzonden` uit Sheet + campagne-context

## Sequentie

| Fase | Timing | Doel | Toon |
|------|--------|------|------|
| FU0 | 3 dagen na eerste mail | Zachte reminder | Kort, vriendelijk, geen nieuwe info |
| FU1 | 5-7 dagen na FU0 | Nieuw haakje | Andere invalshoek, waarde toevoegen |
| FU2 | 7-10 dagen na FU1 | Break-up mail | Laatste poging, expliciet afsluiten |

Na FU2: lead gaat naar status `Afgerond_geen_reactie`. Niet meer mailen.

## FU0 — Zachte reminder

**Wanneer:** 3 dagen na eerste mail, geen reactie.

**Structuur:**
```
Hoi [voornaam als bekend],

Ik stuurde eerder een mail over [pijnpunt in 3 woorden]. Kwam die aan?

Mocht je nieuwsgierig zijn: ik kan in 15 minuten laten zien hoe dit
er voor [bedrijfsnaam] uit zou zien. Geen verplichtingen.

[dag] [tijd] of [dag] [tijd]?

Groet,
Gijs
06-29377440
```

**Regels:** Max 50 woorden. Geen herhaling van de hele pitch. Gewoon checken of de mail aankwam.

## FU1 — Nieuw haakje

**Wanneer:** 5-7 dagen na FU0, geen reactie.

**Structuur:** Gebruik een ANDER haakje dan de eerste mail:

| Als eerste mail ging over... | FU1 gaat over... |
|------------------------------|------------------|
| Personeelstekort | Subsidie (Datamaturiteit MKB, SLIM) |
| Tijdsbesparing | E-facturatie verplichting 2028 |
| Subsidie | Concrete case/voorbeeld |
| E-facturatie | Tijdsbesparing |

```
Hoi [voornaam als bekend],

Nog even over die automatisering — [nieuw haakje in 1-2 zinnen].

[Concreet voorbeeld of feit dat relevant is voor hun sector]

Wil je even sparren of dit voor [bedrijfsnaam] interessant is?
[dag] [tijd] werkt goed voor mij.

Groet,
Gijs
```

**Regels:** Max 70 woorden. Voeg iets nieuws toe — geen herhaling.

**Na FU1:** Zet `bel_reminder_datum` = volgende werkdag. Meld aan Gijs: "Bel-reminder: [bedrijfsnaam] [telefoon] morgen."

## FU2 — Break-up mail

**Wanneer:** 7-10 dagen na FU1, geen reactie.

**Structuur:**
```
Hoi [voornaam als bekend],

Ik snap dat het druk is. Dit is mijn laatste mail hierover.

Mocht je in de toekomst iets willen automatiseren — mijn inbox
staat open: gijs@smitssolutions.nl.

Succes!

Groet,
Gijs
```

**Regels:** Max 40 woorden. Vriendelijk, niet passief-agressief. Geen CTA met tijden. Expliciet afsluiten — dit creëert subtiele urgentie zonder druk.

## Timing

- Verstuur follow-ups op di/wo/do, 08:00-10:00
- Nooit op maandag (inbox vol) of vrijdag (weekend-modus)
- Nooit twee mails naar dezelfde lead op dezelfde dag

## Sheet updates per fase

| Fase | Status | Extra velden |
|------|--------|-------------|
| FU0 verzonden | `FU0_verzonden` | `follow_up_count` = 1, `laatste_fu_datum` = nu |
| FU1 verzonden | `FU1_verzonden` | `follow_up_count` = 2, `laatste_fu_datum` = nu, `bel_reminder_datum` = morgen |
| FU2 verzonden | `FU2_verzonden` | `follow_up_count` = 3, `laatste_fu_datum` = nu |
| Na FU2 | `Afgerond_geen_reactie` | — |
| Reactie ontvangen | `Reactie` | `reactie_datum` = nu, notities |
| Opt-out | `Opt-out` | `blacklist` = true |

## Batch-overzicht

Als Gijs vraagt "wie moet een follow-up?", toon:

```
📋 Follow-up overzicht:

FU0 nodig (3+ dagen geen reactie):
- [Bedrijf A] — verzonden [datum] — [sector]
- [Bedrijf B] — verzonden [datum] — [sector]

FU1 nodig (5-7 dagen na FU0):
- [Bedrijf C] — FU0 op [datum] — [sector]

FU2 nodig (7-10 dagen na FU1):
- [Bedrijf D] — FU1 op [datum] — [sector]

🔔 Bel-reminders:
- [Bedrijf C] — [telefoon] — vandaag

Wil je dat ik de follow-ups schrijf?
```

## Goedkeuring

Zelfde als bij emails:
```
📧 FU[0/1/2] — [Bedrijfsnaam]
Onderwerp: Re: [originele onderwerp]

[follow-up body]

---
Versturen? (y / n / e / s)
```
