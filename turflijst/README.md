# Turflijst

Gedeelde drankteller voor een vriendengroep (maximaal 15 mensen). Iedereen ziet live elkaars registraties, foto's, punten en voortgang. Geen account nodig: wie de uitnodigingslink of groepscode heeft, doet mee.

- **Website**: statische bestanden (`index.html`, `app.js`, `backend.js`), te hosten op Vercel.
- **Database, live updates en foto's**: Supabase (gratis plan is genoeg).

## Eenmalig instellen

1. **Supabase-project**: maak op [supabase.com](https://supabase.com) een gratis project aan, met een regio in de EU.
2. **Anonieme logins aanzetten**: Authentication → Sign In / Providers → zet *Allow anonymous sign-ins* aan en sla op.
3. **Database aanmaken**: SQL Editor → New query → plak de inhoud van `supabase/setup.sql`. Vervang onderaan `KIES-EEN-GROEPSCODE` door jullie eigen groepscode en klik op Run.
4. **Koppelen**: vul in `config.js` de Project URL en de *publishable key* in (bovenaan in Supabase op **Connect**, of Project Settings → API Keys). Gebruik nooit de `service_role`- of secret key.
5. **Vercel**: Add New → Project → importeer deze GitHub-repo. Framework Preset *Other*, geen build command. Deploy.
6. Open de site, ga naar **Groep** en stuur de uitnodigingslink naar je vrienden.

## Goed om te weten

- **Toegang**: zonder groepscode kan niemand de gegevens lezen of wijzigen (Row Level Security in Postgres). Wie de code of link heeft, kan alles in de groep zien en aanpassen; deel hem dus alleen met vrienden. Een nieuwe code instellen: draai de laatste regel van `setup.sql` opnieuw met een andere code.
- **Foto's** staan in een openbare Supabase-bucket onder namen die je niet kunt raden. Wie de exacte link van een foto heeft, kan hem openen.
- **Inloggen per apparaat**: elk apparaat krijgt een anonieme login. Wist iemand zijn browsergegevens, dan opent diegene de link opnieuw en kiest zijn naam weer. Staat die naam op "bezet", geef hem dan vrij bij Groep.
- **Gratis Supabase-projecten** worden gepauzeerd na een week zonder gebruik. Zet ze dan in het dashboard weer aan; er gaat niets verloren.
- **Op het beginscherm**: iPhone via Safari → Deel → Zet op beginscherm; Android via het Chrome-menu → Toevoegen aan startscherm.

## Bestanden

| Bestand | Wat het is |
|---|---|
| `index.html` | Opmaak en stijl |
| `app.js` | De app: tellen, feed, spel, ranglijst, groep, profielen, grafieken |
| `backend.js` | Koppeling met Supabase: documenten, live updates, foto's, wie er online is |
| `config.js` | Supabase-URL en publishable key |
| `supabase/setup.sql` | Tabellen, toegangsregels en fotomap |
| `vendor/supabase.js` | Supabase JavaScript-client 2.117.3 |

## Testen

`tools/e2e.js` speelt twee vrienden in twee aparte browsers na (Playwright met Chromium nodig):

```
node tools/e2e.js --mock                     # met een nagebootste Supabase
node tools/e2e.js --real --code=GROEPSCODE   # tegen het echte project in config.js
```

De echte test maakt twee namen `Test-…` aan, controleert of alles live bij de ander aankomt (registratie, foto, proost, online, grafieken) en verwijdert daarna wat hij heeft aangemaakt.
