# The Elm — session handoff

Written at the end of a cloud session. Everything below is either in this
repo or stated as unverified. Branch: `claude/stoic-planck-779oda`.

---

## 1. What is in this repo

| File | State |
|---|---|
| `Elm_Housekeeping_Inventory.docx` | 95 rows, 70 part numbers, bilingual. Live. |
| `LaQuinta_Frisco_Housekeeping_Inventory.docx` | 75 rows, 60 part numbers. Incomplete — see §5. |
| `Elm_Linen_Towel_Inventory.docx` | 3 tables: Bed Linen 22, Towels 8, Reclaim 29. No part numbers. |
| `ElmBar_Code_v6.gs` | Apps Script for the bar inventory. Pasted into the live project. |

The user keeps working copies in Google Drive and edits them there, so the
Drive version and the repo version drift. Their edits so far have been
cosmetic (stripping section subtitles). **Always diff before assuming.**

---

## 2. Bar script — ElmBar_Code_v6.gs

Apps Script project **"Elm Bar Inventory Builder"**. It edits an existing
form and sheet by ID and creates nothing, which is what keeps the printed
QR code at the bar working. Verified by grep: no `FormApp.create()`,
no `SpreadsheetApp.create()`, no `DriveApp`.

- spreadsheetId `1jIg0zcK2UANbu9ALyNSTV-DqWsk_XEwk2K8JJ-TFAuE`
- formId `1UbwucJLn7pyJd8hRb8bh_WVL3iXVM3SGZLwO7ab5UXo`

### v6 is v5 plus
- **Six fill levels**, unevenly spaced: E, 1/8, 1/4, 1/2, 3/4, Full. Fine
  near empty where the reorder decision lives, coarse above half.
  `LEVEL_TO_FRACTION` still knows all nine so older weeks still read.
- **Straight-line detection**. 70%+ identical levels flags the column
  rather than rejecting it. Derived from the readings, not from a header
  marker, so it reaches backwards into history.
- **9:30pm reminder to bartenders only**, and only on nights with no count.
- **Roster** on the Manager Dashboard, columns J–L, survives a refresh.
- **Dashboard overhaul**: At a Glance, week strip, Search, Order This Week,
  Counts Needing a Check, then chronic/par/trend.
- **Optional Email question**, `EMAIL_QUESTION_REQUIRED = false`.
- **Run-once functions** sit below a `ONE-TIME SETUP — SAFE TO DELETE`
  banner at the end of the file. Nothing above calls into it.

### Confirmed run by the user
`addEmailQuestion()` · `refreshDashboardNow()` · `seedParLevelsFromSuggested()`

### NOT confirmed — check these first
1. **The roster is empty.** Until names and emails are in dashboard J–L,
   the 9:30pm reminder reaches nobody. This is the top item.
2. `installReminderTrigger()` — no log was ever pasted. Check the clock
   icon in the Apps Script sidebar for `sendNightlyReminder`.
3. `applySixLevels()` — no log pasted. Open the form and count the columns.
4. `makeDateQuestionADatePicker()` — written, never run.
5. **No real phone submission** since the Email question was added, so the
   email → roster path is untested end to end.

### The bug that mattered
`formatDateShort` could not read a `Date` object. `countExistsForToday`
calls it as `formatDateShort(new Date())`, so the match always failed and
the nightly reminder would have fired **every night regardless of whether
the count was in**. Fixed. It is also how a Date object was written into a
stock-level cell (§3).

---

## 3. Known bad data in the bar spreadsheet

| Where | Problem |
|---|---|
| 10/06–10/12 tab, column header | Reads `8/6 PM Brian Pernia`. Typed 8/6 for 10/6. Dashboard compensates but the coverage strip cannot attribute it to a night. |
| 09/08–09/14 tab, Ancho Reyes | Cell contains `Fri Jan 02 2026 00:00:00 GMT-0600`. Counts as 0% fill. |
| 09/18 column | All 44 bottles at `1/2`, backups typed as "Same". A straight-line, now flagged by the dashboard. |
| 09/15–09/21 week | Backup counts read "Same" / "Samr" / "Same." throughout. Unusable. |
| Par levels | Seeded from suggested, so every Flag reads blank until someone overrides. Seeding never overwrites a number a human set. |

---

## 4. Housekeeping sheet — open items

Three blank part numbers, deliberately not invented:
- Facial tissue backup options
- Garment steamer / DND hanger / pet sign — numbers came from a browsing
  pass, not from the user's own HD Supply account. **Unverified.**

Three discrepancies flagged inside the row text rather than silently fixed:
- **Shower brackets** — HD Supply shows Case Of 48, both sheets said 43
- **10oz wrapped cup 120213** — listing says use lid **412263**, not 126935
- **Towel hanger card** — HD Supply lists **206622**, not 206822, and shows
  it unavailable

Verified from the user's own HD Supply screenshots, so these beat any other
source: toilet paper **531343**, facial tissue **117979**, gloves
**147688** (L) / **147689** (XL), condiment kit **132552**.

---

## 5. La Quinta Frisco sheet — what it is missing

Built from that property's own inventory list, which never had:
- **No Front Desk section at all** — key folders 757774 and memo pads
  357248 are Wyndham Rewards items both brands use
- **No Branding section** — no linen card, towel card, DND or pet sign
- **No coffee pods and no brewer**, despite listing a coffee basket, cups,
  lids and condiment kits. This looks like a gap in their list, not a
  choice. Worth asking Frisco directly.
- Ironing board pad & cover, microfiber towels, gloves in S and M

---

## 6. Linen sheet — open items

- **Every part number is blank.** None exist in anything shared: not the
  hotel inventory lists, not the HD Supply screenshots, not Drive. Linen is
  a separate program from amenities and chemicals.
- **Towel sizes are the usual hotel sizes**, not confirmed ones.
- Pool towels and bathrobes are assumptions.
- Reclaim mirrors all 26 items. Last column is Cantidad; Par was removed
  from the whole sheet because it means something different for linen
  ("3 par" = one on the bed, one in the wash, one on the shelf).

### The Spanish came from the damage reports, not a dictionary
`Elm damages 2026-09.xlsx` in Drive keeps each housekeeper's original
Spanish word for word. Six people use the same terms:

| English | Use this | Not this |
|---|---|---|
| washcloth | toalla de cara | toallita / manopla |
| hand towel | toalla mediana | toalla de manos |
| bath towel | toalla grande | toalla de baño |
| fitted sheet | sábana de resorte | sábana ajustable |
| flat sheet | sábana grande | sábana plana |
| duvet cover | duvet | funda de edredón |
| pillowcase, standard | funda chica | funda estándar |

**Keep using that file as the vocabulary source.** It is the only record of
how the team actually talks.

### Offered, not done
Add a **Valor** column to Reclaim using the approved charge list in the
same damages file: washcloth $8, hand towel $15, bath towel $25, sheet $45,
duvet cover $30, pillowcase $18, pillow $45. Turns the reclaim tally into a
dollar figure.

---

## 7. Environment — what did not work from the cloud

A local session may have more. Do not repeat these dead ends blindly.

- **No browser control.** No `claude-in-chrome` or built-in browser tools.
  The user has the Claude Chrome extension installed, but that is a
  separate session in their browser and exposes nothing here.
- **Remote Control: `Dorado / Documents` returns `not_available`.** The
  Claude app on that Windows machine is not serving the folder. If a local
  session runs on Dorado this is moot.
- **Gmail: insufficient scope.** Read access was never granted, so the GM
  email cross-check never happened.
- **Drive: read works, no update tool.** Files can be read and created but
  not overwritten, so the user's Drive copies must be re-uploaded by hand.
- `python-docx` installed with pip; all docx edits go through it.
- LibreOffice will not render here, so no docx was ever visually verified —
  only structurally.

### Docx gotcha
These files are built by cloning paragraphs and tables from an existing
document to keep styling. The user's edits removed section subtitles,
leaving **empty spacer paragraphs** in their place. Picking a template
paragraph by index without checking it has text produces blank headings.
Always print `runs` and text before choosing an index.

---

## 8. If you only do three things

1. **Seed the bar roster** in dashboard J–L and confirm the 9:30pm trigger
   exists. Without it the reminder is dead code.
2. **Get linen part numbers** from the user or their linen supplier.
3. **Ask Frisco about coffee pods.** A hotel with cups, lids and a coffee
   basket but no pods on its inventory list has a hole in the list.
