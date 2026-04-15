---
name: competitor-scanner
description: Run a competitive analysis scan of Dutch automation/AI agencies that compete with Smits Solutions. Use this skill whenever Gijs asks to scan competitors, check what competitors are doing, run a concurrentie-analyse, monitor the automation agency market, compare pricing or positioning with other agencies, or asks anything like "wat doen mijn concurrenten", "scan de markt", "concurrentie check", "wat is er veranderd bij concurrenten", "competitor update", or "marktanalyse". Also trigger when Gijs mentions specific competitor names from the target list (n8nera, n8nWorkflows, Datakoppelaars, EasyData, NinA AI, Automatiseerhet, AI-agents.nl, NovaClaw, PromptGorillas, etc.) and wants to know what they're up to.
---

# Competitor Scanner — Smits Solutions

Scan and analyze Dutch automation/AI agencies that compete with Smits Solutions (smits-solutions.nl). The goal is to give Gijs actionable intelligence: pricing changes, new cases, new sectors, positioning shifts, and strategic opportunities.

## Competitor Target List

Read `references/competitors.md` for the full target list with URLs, platforms, pricing, and notes per competitor. Always load this file before running a scan.

## How to Run a Scan

### Full scan (default when Gijs says "scan concurrenten" or similar)

For each competitor in the target list:

1. **Fetch their homepage** — look for changes in positioning, new services, new copy
2. **Fetch their cases/portfolio page** (if they have one) — new client cases, new sectors, new results
3. **Fetch their pricing page** (if they have one) — price changes, new packages
4. **Check for blog posts** — new content topics, thought leadership positioning

Then synthesize findings into a structured report:

```
## Concurrentie Scan — [datum]

### Belangrijkste wijzigingen
[Top 3-5 meest relevante veranderingen]

### Per concurrent
[Only include competitors where something noteworthy was found]

#### [Naam] — [website]
- **Wat veranderd**: [beschrijving]
- **Relevantie voor Smits Solutions**: [waarom dit ertoe doet]
- **Actie**: [wat Gijs hiermee kan doen]

### Strategische inzichten
[Overkoepelende trends, kansen, bedreigingen]

### Aanbevolen acties
[Concrete next steps voor Gijs, gerangschikt op prioriteit]
```

### Quick scan (when Gijs asks about a specific competitor)

Fetch only that competitor's pages. Report on what you find with the same structure (what changed, relevance, action).

### Pricing comparison

When Gijs asks about pricing or positioning relative to competitors:

1. Load the competitor list from `references/competitors.md`
2. Fetch pricing pages of competitors that list prices
3. Create a comparison table:
   - Competitor name
   - Setup/project fee
   - Monthly/recurring fee
   - What's included

### Sector analysis

When Gijs asks which sectors competitors target:

1. Scan case study pages and homepage copy of all competitors
2. Map which sectors each competitor serves
3. Identify gaps: sectors no one is serving yet
4. Rank opportunities for Smits Solutions

## Important Guidelines

- **Language**: Write the report in Dutch (Gijs's working language) unless he asks for English
- **Be direct**: No filler. Only report what matters. If a competitor hasn't changed anything, skip them.
- **Be strategic**: Don't just describe what you see — explain what it means for Smits Solutions and what Gijs should do about it
- **Pricing intel**: When you find pricing info, flag notable changes or positioning
- **Sector intel**: When you see competitors entering the installatiebedrijven/bouw sector, flag it immediately — that's Gijs's primary target
- **Noord-Brabant focus**: Any competitor activity in Noord-Brabant is extra relevant
- **Save findings**: If the scan reveals important strategic changes, suggest Gijs updates the competitor spreadsheet
