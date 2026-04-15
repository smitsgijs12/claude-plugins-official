# Send — Emails versturen via n8n webhook

## Input: goedgekeurde email (Gijs heeft `y` getypt)

## Webhook

Verstuur via HTTP POST naar de n8n webhook:

```
POST [WEBHOOK_URL]
Content-Type: application/json

{
  "to": "[email]",
  "subject": "[onderwerp]",
  "body": "[email body]",
  "bedrijfsnaam": "[bedrijfsnaam]",
  "type": "[eerste_mail / FU0 / FU1 / FU2]",
  "spoor": "[A / B]",
  "campagne_sector": "[sector]",
  "campagne_regio": "[regio]"
}
```

**WEBHOOK_URL:** Moet door Gijs worden ingevuld bij eerste gebruik. Vraag ernaar als deze nog niet geconfigureerd is.

## Pre-send checks

Voer ALTIJD uit voor verzending:

1. **Blacklist check:** `blacklist` ≠ true
2. **Opt-out check:** `status` ≠ "Opt-out"
3. **Duplicaat check:** email is niet al eerder gemaild vandaag
4. **Rate limit check:** max 10/dag (eerste 2 weken: max 5/dag)
5. **Dag check:** alleen di/wo/do
6. **Tijd check:** bij voorkeur 08:00-10:00

Bij falen van een check: meld aan Gijs welke check faalde, stuur niet.

## Post-send updates

1. Update Sheet:
   - `status`: `Verzonden` (eerste mail) of `FU[0/1/2]_verzonden`
   - `verzonden_op`: datum + tijd
   - `email_onderwerp`: onderwerpregel
   - `follow_up_count`: 0 (eerste mail), +1 (follow-ups)
   - `laatste_fu_datum`: datum (alleen bij follow-ups)
   - `bel_reminder_datum`: volgende werkdag (alleen na FU1)
   - `spoor`: A of B

2. Bevestig aan Gijs:
   ```
   ✅ Verzonden: [bedrijfsnaam] ([email])
   Type: [eerste mail / FU0 / FU1 / FU2]
   Vandaag verzonden: [X]/[max] emails
   ```

## Error handling

| Error | Actie |
|-------|-------|
| Webhook faalt (timeout/500) | Retry 1x na 30 sec. Nog steeds fout → log als `status: SEND_ERROR`, meld aan Gijs |
| Email bounced (als detecteerbaar) | `status: Bounced`, `blacklist: true`, meld aan Gijs |
| Rate limit bereikt | Stop, meld hoeveel er nog in de queue staan |
| Webhook URL niet geconfigureerd | Vraag Gijs om de URL |

## Domein-opwarming schema

| Week | Max/dag | Opmerking |
|------|---------|-----------|
| 1-2 | 5 | Nieuwe mailbox opwarmen |
| 3-4 | 8 | Langzaam opschalen |
| 5+ | 10 | Normaal volume |

## Portfolio tracker

Als spoor A actief, houd bij:
- Portfolio mails verzonden: [X] / 8 max
- Portfolio deals gesloten: [X] / 3 max
- Als 3 deals gesloten: meld aan Gijs, stop spoor A automatisch

## Dagelijkse samenvatting

Na de laatste verzending van de dag:
```
📊 Dagrapport [datum]:
- Verzonden: [X] eerste mails, [Y] follow-ups
- Totaal vandaag: [X+Y] / [max]
- Portfolio: [P] / 8 mails, [D] / 3 deals
- Errors: [E]
- Bel-reminders morgen: [lijst]
```
