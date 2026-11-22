# bots

## check_inventory.py

Runs the inventory-sheet checks listed in `../TASKS.md` section A.

    pip install python-docx
    python bots/check_inventory.py

- Reads only. It never edits a sheet.
- Writes `bots/logs/check-<date>-<time>.log`.
- Exits 0 if nothing failed, 1 if anything did.

Run it before sending a sheet to anyone, and after editing one in Google
Docs and downloading it back — that round trip is where things break.

## glossary_es.json

The approved Spanish, taken from `Elm damages 2026-09.xlsx` in Drive: the
housekeepers' own words, kept word for word in that file by six different
people. `require` is what a linen or towel row must say; `forbid` is
dictionary Spanish that has been superseded. `scope_keywords` limits both
to linen and towel rows, because the same word can be right elsewhere —
"toallitas desmaquillantes" is the correct name for makeup remover wipes.

Also holds the approved replacement values, for TASKS.md D1.

## Adding a check

Add a function, call it from `main()`, and use `mark("pass"|"warn"|"fail", ...)`.
Anything done by hand twice belongs here.
