# The Elm — task list

The checklist for this lane. It lives in the tree so it outlives any
session. The automated part is run by `bots/check_inventory.py`; the rest
needs a person, and says who.

Run the bot before sending any sheet to anyone:

    python bots/check_inventory.py

Reads only, never edits a sheet. Writes `bots/logs/check-<date>.log` and
exits non-zero if anything failed. Needs `pip install python-docx`.

---

## A. Run by the bot

| # | Check | Covers |
|---|---|---|
| A1 | `document.xml` parses | every sheet |
| A2 | Tables share a column count | every sheet |
| A3 | No duplicate part numbers | every sheet |
| A4 | Every named item has Spanish | every sheet |
| A5 | Rows with no part number, counted | every sheet (warn) |
| A6 | Spanish matches `bots/glossary_es.json` | linen and towel rows |
| A7 | HD Supply warnings still in the text | Elm housekeeping |
| A8 | The bar script creates no form or sheet | `ElmBar_Code_v6.gs` |
| A9 | `formatDateShort` handles a real `Date` | `ElmBar_Code_v6.gs` |

**A8 is the one that matters most.** The printed QR at the bar points at
one form id. Anything that creates a form mints a new URL and the QR dies.
The bot asserts it on every run.

**A9** guards the bug that would have made the 9:30pm reminder fire every
night regardless of whether the count was in.

Last run: 23 pass, 3 warn, 0 fail.

---

## B. Needs a person — bar system

Nobody can automate these; they are logins and physical checks.

| # | Task | Who | Blocking? |
|---|---|---|---|
| B1 | Seed the bartender roster in Manager Dashboard **J–L** with names and emails, then `refreshDashboardNow()` | Roberto | **Yes.** The roster is empty, so the 9:30pm reminder reaches nobody. |
| B2 | Confirm `sendNightlyReminder` exists under the clock icon in Apps Script | Roberto | **Yes.** Never verified. |
| B3 | Run `applySixLevels()` and count the columns on the form | Roberto | No — likely already done, never logged |
| B4 | Submit one real count from a phone | any bartender | **Yes.** The email → roster path is untested end to end. |
| B5 | Run `makeDateQuestionADatePicker()` | Roberto | No — written, never run |
| B6 | Fix the `8/6` column header in the 10/06–10/12 tab | Roberto | No |
| B7 | Fix the Ancho Reyes cell in 09/08–09/14 — it holds a `Date` object, counts as 0% fill | Roberto | No |

**Do not schedule anything.** Roberto's hold on daily-operations changes
stands until his new PC. B1–B7 are manual runs, not new triggers.

---

## C. Needs an answer — inventory sheets

| # | Question | Ask |
|---|---|---|
| C1 | Linen part numbers — none exist in any file shared so far | the linen supplier, or Roberto |
| C2 | Towel sizes — 27×54 / 16×30 / 13×13 / 20×30 are the usual hotel sizes, not confirmed ones | housekeeping |
| C3 | Are there pool towels and bathrobes? Both are assumptions | housekeeping |
| C4 | Frisco: no coffee pods and no brewer on the list, but cups, lids, condiment kits and a coffee basket are. Hole in the list? | Frisco |
| C5 | Frisco has no Front Desk and no Branding section — key folders 757774 and memo pads 357248 are Wyndham items both brands use | Frisco |
| C6 | Linen change policy — every third night, on request, daily? Sets linen par, and the room-turn draft is blocked on it | Roberto / GM |
| C7 | Facial tissue, garment steamer, DND hanger, pet sign — numbers came from a browsing pass, not the Elm's own HD Supply account. Unverified | confirm at order time |

---

## D. Offered, not built

| # | Item | Note |
|---|---|---|
| D1 | **Valor** column on the linen Reclaim section | Values are already in `bots/glossary_es.json`, taken from the approved charge list. Turns the reclaim tally into a dollar figure. |
| D2 | Weekly miss-summary to managers | "Last week 4 of 7 nights counted." Would need a schedule — held. |
| D3 | GM home-screen page (Apps Script web app) | Would show At a Glance and Order This Week on her phone. Not started. |

---

## E. Conventions this lane keeps

- **The Spanish column uses the crew's own words**, sourced from
  `Elm damages 2026-09.xlsx` in Drive, not a dictionary. `bots/glossary_es.json`
  holds them and the bot enforces them.
- **Part numbers are never invented.** A blank cell beats a wrong SKU on a
  sheet somebody orders from.
- **Discrepancies are flagged in the row text**, not silently corrected,
  so the person ordering sees them.
- **The bar script edits the existing form and sheet by id.** Never create.
