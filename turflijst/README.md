# Turflijst

Gedeelde drankteller voor een vriendengroep (maximaal 15 mensen). Iedereen ziet live elkaars registraties, foto's, punten en voortgang. Geen account nodig: wie de uitnodigingslink of groepscode heeft, doet mee.

- **Website**: statische bestanden (`index.html`, `app.js`, `backend.js`), te hosten op Vercel.
- **Database, live updates en foto's**: Supabase (gratis plan is genoeg).

## Eenmalig instellen

1. **Supabase-project**: maak op [supabase.com](https://supabase.com) een gratis project aan, met een regio in de EU.
2. **Anonieme logins aanzetten**: Authentication → Sign In / Providers → zet *Allow anonymous sign-ins* aan en sla op.
3. **Database aanmaken**: SQL Editor → New query → plak de inhoud van `supabase/setup.sql`. Vervang onderaan `KIES-EEN-GROEPSCODE` door jullie eigen groepscode en klik op Run. Onderaan in de resultaten zie je de opgeslagen code.
   - De code moet minstens 8 tekens hebben (letters, cijfers, spaties of streepjes). Kies iets wat buitenstaanders niet raden, bijvoorbeeld twee woorden en een getal. Hoofdletters en spaties maken niet uit.
   - Vergeet je de code te vervangen, dan stopt het script met een melding en wordt er niets aangemaakt.
   - Vul de code alleen in de SQL Editor in, niet in het bestand in GitHub.
   - Laat de limiet voor anonieme logins op de standaardwaarde staan (Authentication → Rate Limits). Samen met de limiet op foute codes maakt dat raden heel lastig.
4. **Koppelen**: vul in `config.js` de Project URL en de *publishable key* in (bovenaan in Supabase op **Connect**, of Project Settings → API Keys). Gebruik nooit de `service_role`- of secret key.
5. **Vercel**: Add New → Project → importeer deze GitHub-repo. Framework Preset *Other*, geen build command. Deploy.
6. Open de site, ga naar **Groep** en stuur de uitnodigingslink naar je vrienden.

## Goed om te weten

- **Toegang**: zonder groepscode kan niemand de gegevens lezen of wijzigen (Row Level Security in Postgres). Wie de code of link heeft, kan alles in de groep zien en aanpassen; deel hem dus alleen met vrienden. Code gelekt of telefoon kwijt? Zie [Beheer](#beheer-in-de-sql-editor).
- **Foute codes**: na 10 verschillende foute codes binnen 10 minuten (of 30 op een dag) moet dat apparaat even wachten. Wie al meedoet, merkt daar niets van.
- **Foto's** staan in een openbare Supabase-bucket onder namen die je niet kunt raden. Wie de exacte link van een foto heeft, kan hem openen. Verwijder je een foto in de app, dan wordt hij ook echt uit de bucket gehaald.
- **Wie er online is** ("Nu in de app") loopt via een openbaar Realtime-kanaal. Wie het adres van de site kent, kan daarin zien hoeveel mensen de app open hebben, of een nep-naam als online laten zien. Drankjes, foto's en reacties kan diegene niet zien of aanpassen. Dat risico nemen we bewust.
- **Inloggen per apparaat**: elk apparaat krijgt een anonieme login. Wist iemand zijn browsergegevens, of opent hij de app op een ander toestel of vanaf het beginscherm, dan staat zijn naam daar op "bezet". Tik erop en nog een keer om hem over te nemen; het andere toestel krijgt daar een melding van. Een naam hoort bij één toestel tegelijk. Iedereen kan zo een naam overnemen; dat is geen beveiliging, maar het valt wel op. Een claim bevestigen vanaf het toestel dat hem deed, telt niet.
- **Gratis Supabase-projecten** worden gepauzeerd na een week zonder gebruik. Zet ze dan in het dashboard weer aan; er gaat niets verloren.
- **Op het beginscherm**: iPhone via Safari → Deel → Zet op beginscherm; Android via het Chrome-menu → Toevoegen aan startscherm.

## Beheer in de SQL Editor

Alles hieronder doe je in Supabase: SQL Editor → New query → plak → Run. Vervang `NIEUWE-GROEPSCODE` steeds door een echte nieuwe code; de voorbeeldcode zelf wordt geweigerd.

**Nieuwe versie van `setup.sql`?** Plak het hele bestand en klik op Run. De voorbeeldcode mag dan blijven staan: jullie groepscode en alle gegevens blijven zoals ze zijn. Doe dit na elke update van deze repo, anders werken sommige verbeteringen niet.

**Code wijzigen.** Wie al meedoet, houdt toegang. Alleen nieuwe telefoons hebben de nieuwe code of link nodig.

```sql
update public.groups set code = 'NIEUWE-GROEPSCODE' where id = 'vrienden';
```

**Link gelekt of telefoon kwijt? Iedereen eruit.** Dit geeft de groep een nieuwe code en haalt de toegang van alle apparaten weg. Het is hetzelfde als de code wijzigen plus `delete from public.group_access where grp = 'vrienden';`. Namen, drankjes, foto's en reacties blijven staan.

```sql
select public.reset_group_access('NIEUWE-GROEPSCODE');
```

Open daarna zelf de app, vul de nieuwe code in en stuur de nieuwe link uit **Groep** naar je vrienden. Iedereen opent hem één keer en tikt zijn naam weer aan. Staat een naam op "bezet" omdat hij nog bij de kwijte telefoon hoort? Tik erop en bevestig om hem over te nemen.

**Hoeveel apparaten hebben toegang?** Dat staat in de resultaten van `setup.sql` (`apparaten`, en `zonder_naam` voor apparaten zonder gekozen naam). Of los:

```sql
select count(*) as apparaten from public.group_access where grp = 'vrienden';
```

Zijn het er veel meer dan jullie met z'n allen hebben, gebruik dan "Iedereen eruit".

**Zit iemand vast op "Te vaak geprobeerd"?** Meestal is het na 10 minuten over. Sneller: wis de telling.

```sql
delete from public.join_misses;
```

**Iets kwijt? Zo zet je het terug.** Van elke wijziging en elke verwijdering wordt de oude versie bewaard: wijzigingen 30 dagen, verwijderingen 180 dagen. Alleen jij kunt die zien, hier in de SQL Editor. Een verzoek vanuit de app mag bovendien hooguit 5 dingen tegelijk verwijderen.

Wie heeft wat gedaan in de laatste 24 uur:

```sql
select h.changed_at, h.op, h.path, coalesce(m.data->>'name', h.changed_by::text, 'SQL Editor') as wie
  from public.docs_history h
  left join public.docs m on m.grp = h.grp and m.collection = 'members' and m.data->>'uid' = h.changed_by::text
 where h.grp = 'vrienden' and h.changed_at > now() - interval '1 day'
 order by h.changed_at desc, h.id desc limit 100;
```

Alles wat na een bepaald moment is gewijzigd of verwijderd terugzetten naar hoe het toen was. Pas datum en tijd aan. Wat na dat moment nieuw is gemaakt, blijft staan.

```sql
insert into public.docs (grp, path, collection, data)
select distinct on (path) grp, path, collection, data
  from public.docs_history
 where grp = 'vrienden' and changed_at > '2026-11-13 22:00 Europe/Amsterdam'
 order by path, changed_at, id
on conflict (grp, path) do update set data = excluded.data;
```

De app laat het teruggezette meteen weer zien.

## Bestanden

| Bestand | Wat het is |
|---|---|
| `index.html` | Opmaak en stijl |
| `app.js` | De app: tellen, feed, spel, ranglijst, groep, profielen, grafieken |
| `backend.js` | Koppeling met Supabase: documenten, live updates, foto's, wie er online is |
| `config.js` | Supabase-URL en publishable key |
| `supabase/setup.sql` | Tabellen, toegangsregels, fotomap en geschiedenis |
| `vendor/supabase.js` | Supabase JavaScript-client 2.117.3 |

## Testen

`tools/e2e.js` speelt twee vrienden in twee aparte browsers na (Playwright met Chromium nodig):

```
node tools/e2e.js --mock                     # met een nagebootste Supabase
node tools/e2e.js --real --code=GROEPSCODE   # tegen het echte project in config.js
```

De echte test maakt twee namen `Test-…` aan, controleert of alles live bij de ander aankomt (registratie, foto, proost, online, grafieken) en verwijdert daarna wat hij heeft aangemaakt.

`tools/sql-test.mjs` test `supabase/setup.sql` (ook twee keer draaien en bijwerken vanaf een oudere versie) in PGlite, een Postgres die in Node draait. Installeer PGlite eenmalig in een losse map en geef die map mee:

```
mkdir -p /tmp/pglite && (cd /tmp/pglite && npm i @electric-sql/pglite)
node tools/sql-test.mjs /tmp/pglite
```
