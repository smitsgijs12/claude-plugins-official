---
name: leadgen-pipeline
description: Lead generation pipeline for Smits Solutions. Use this skill EVERY TIME Gijs asks to find leads, scout businesses, qualify prospects, write cold emails, send follow-ups, or do any outreach activity. Trigger on phrases like "zoek leads", "scout", "vind bedrijven", "kwalificeer", "schrijf email", "cold mail", "follow-up", "opvolgen", "verstuur", "send", "outreach", "nieuwe campagne", or any reference to lead generation, prospecting, or sales outreach for Smits Solutions.
---

# Lead Generation Pipeline — Smits Solutions

## Stap 0 — Campagne-context vaststellen

**Vraag ALTIJD eerst aan Gijs voordat je begint:**

```
Voordat ik ga zoeken, even afstemmen:

1. Welke sector/branche? (bijv. installatiebedrijven, schoonmaak, groothandel, bouw...)
2. Subsectoren of specialisaties? (bijv. HVAC, zonnepanelen, technische groothandel...)
3. Welke regio? (bijv. Eindhoven, heel Brabant, specifieke stad...)
4. Bedrijfsgrootte? (standaard: 5-50 medewerkers)
5. Spoor A (portfolio) of Spoor B (standaard)? Of beide?
```

Sla de antwoorden op als **campagne-context**. Alle vervolgstappen gebruiken deze context. Als Gijs later zegt "nu dezelfde search voor Tilburg" of "nu voor schoonmaakbedrijven", update dan alleen het gewijzigde veld.

## Pipeline

```
CONTEXT → SCOUT → QUALIFY → EMAIL → APPROVE → SEND → FOLLOW-UP
```

## Routing

| Trigger | Lees bestand |
|---------|-------------|
| "zoek leads", "scout", "vind bedrijven" | `scout.md` |
| "kwalificeer", "scoor", "beoordeel" | `qualify.md` |
| "schrijf email", "mail voor", "cold mail" | `email.md` |
| "follow-up", "wie moet een follow-up", "opvolgen" | `followup.md` |
| "verstuur", "send", na goedkeuring (`y`) | `send.md` |

Bij een complete opdracht ("zoek leads en mail ze"): lees bestanden per stap, niet allemaal tegelijk.

## Globale regels

1. **NOOIT een email versturen zonder Gijs' goedkeuring (`y`)**
2. **NOOIT meer dan 10 emails per dag** (eerste mails + follow-ups samen)
3. **Eerste 2 weken: max 5/dag** (domein-opwarming gijs@smitssolutions.nl)
4. **ALTIJD Sheet checken op duplicaten voor je begint**
5. **ALLES loggen in de Google Sheet** — ook overgeslagen leads
6. **Bij crash/limiet:** de Sheet is de brug. Log waar je bent, hervat in nieuwe sessie.
7. **Campagne-context meegeven** aan elke vervolgstap

## Twee sporen

| Spoor | Doel | Aanbod | Limiet |
|-------|------|--------|--------|
| A: Portfolio | 2-3 cases opbouwen | Geen projectfee, alleen hosting (€75-150/mnd). In ruil: testimonial + case study | Max 8 mails, max 3 deals. Zodra 3 gesloten → stop |
| B: Standaard | Betaalde klanten | Projectfee + hosting. CTA = gratis diagnose-gesprek 30 min | 10 emails/dag, di-do 08:00-10:00 |

Spoor A eerst. Zodra 3 portfolio-deals gesloten → alleen nog spoor B.

## Sales haakjes (uit marktonderzoek april 2026)

Gebruik deze per sector als opener — één specifiek pijnpunt, niet het totaalverhaal:

| Haakje | Inzet | Sterkte |
|--------|-------|---------|
| **Personeelstekort** | 2/3 ondernemers, 80%+ in bouw | Sterkste trigger. "Je zoekt mensen die je niet kunt vinden — wat als je de admin wegautomatiseert?" |
| **Subsidies** | Datamaturiteit MKB (€4.000), SLIM (€25.000), MIT Zuid (40%) | Drempelverlager. "Een project van €3.000 kost je na subsidie misschien €500." |
| **E-facturatie** | EU-verplichting 2028/2030, 10% MKB voorbereid | Urgentie. "Je moet toch over — laten we meteen het hele proces automatiseren." |

## Smits Solutions context

| Gegeven | Waarde |
|---------|--------|
| Bedrijf | Smits Solutions |
| Website | smitssolutions.nl |
| Email | gijs@smitssolutions.nl |
| Eigenaar | Gijs Smits |
| Locatie | Eindhoven, Noord-Brabant |
| Dienst | n8n workflow automatisering voor MKB |
| Calculator | smitssolutions.nl/calculator |
| Hosting tiers | Basis €75/mnd · Standaard €150/mnd · Premium €300/mnd |
| Zonder SLA | €95-125/uur · spoed €125-150/uur |
| Markt | Noord-Brabant ~18.000 bedrijven (5-50 mdw), 4.000-5.000 in bouw/installatie. Geen gespecialiseerde n8n agency in Brabant |
