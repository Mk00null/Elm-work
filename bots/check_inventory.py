#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
The Elm - inventory sheet checker.

Runs the checks that were being done by hand, every time one of these
files changed. Reads only; it never edits a sheet. Writes a timestamped
log to bots/logs/ and prints the same report.

    python bots/check_inventory.py

Needs python-docx:  pip install python-docx
Exit code 0 if nothing failed, 1 if any FAIL.
"""
import io, json, os, re, sys, zipfile, datetime
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS = os.path.join(ROOT, "bots", "logs")

SHEETS = [
    "Elm_Housekeeping_Inventory.docx",
    "LaQuinta_Frisco_Housekeeping_Inventory.docx",
    "Elm_Linen_Towel_Inventory.docx",
]
SCRIPT = "ElmBar_Code_v6.gs"

# Discrepancies found against HD Supply. Each must still be visible in the
# sheet, so a later edit cannot quietly drop the warning.
FLAGS_REQUIRED = {
    "Elm_Housekeeping_Inventory.docx": [
        ("shower brackets case size", "48"),
        ("lid for the 10oz cup",      "412263"),
        ("towel hanger card number",  "206622"),
    ],
}

out = []
def say(line=""):
    out.append(line)
    print(line)

results = {"pass": 0, "warn": 0, "fail": 0}
def mark(level, check, detail=""):
    results[level] += 1
    say("  [%-4s] %-38s %s" % (level.upper(), check, detail))

def rows_of(doc):
    """(table_index, row_index, [cell texts]) for every non-header row."""
    for ti, t in enumerate(doc.tables):
        for ri, r in enumerate(t.rows):
            if ri == 0:
                continue
            yield ti, ri, [c.text.strip() for c in r.cells]

def check_sheet(path, glossary):
    name = os.path.basename(path)
    say("\n=== %s ===" % name)
    if not os.path.exists(path):
        mark("fail", "file present", "not found")
        return

    # 1. the file is not corrupt
    try:
        xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
        ET.fromstring(xml)
        mark("pass", "document.xml parses")
    except Exception as e:
        mark("fail", "document.xml parses", str(e)[:70])
        return

    from docx import Document
    doc = Document(path)

    # 2. every table has the same column count
    widths = {len(t.columns) for t in doc.tables}
    if len(widths) == 1:
        mark("pass", "tables share a column count", "%d columns" % widths.pop())
    else:
        mark("fail", "tables share a column count", "found %s" % sorted(widths))

    # 3. no part number appears twice - a duplicate gets counted twice
    seen, dupes, blanks, total = {}, [], 0, 0
    for ti, ri, cells in rows_of(doc):
        if not any(cells):
            continue
        total += 1
        pn = cells[0]
        if pn:
            seen[pn] = seen.get(pn, 0) + 1
        elif cells[1]:
            blanks += 1
    dupes = {k: v for k, v in seen.items() if v > 1}
    if dupes:
        mark("fail", "no duplicate part numbers", str(dupes))
    else:
        mark("pass", "no duplicate part numbers", "%d unique" % len(seen))

    # 4. every named row has both languages
    missing_es = [c[1][:40] for _, _, c in rows_of(doc) if c[1] and not c[2]]
    if missing_es:
        mark("fail", "every item has Spanish", "%d missing: %s"
             % (len(missing_es), "; ".join(missing_es[:3])))
    else:
        mark("pass", "every item has Spanish")

    # 5. blank part numbers are expected, but the count should be known
    if blanks:
        mark("warn", "rows with no part number", "%d of %d" % (blanks, total))
    else:
        mark("pass", "rows with no part number", "none")

    # 6. the Spanish matches what the crew actually writes
    req, forbid = glossary["require"], glossary["forbid"]
    scope = [k.lower() for k in glossary.get("scope_keywords", [])]
    bad = []
    for _, _, cells in rows_of(doc):
        en, es = cells[1], cells[2]
        if not en or not es:
            continue
        # Only judge linen and towel rows. The same Spanish word can be
        # right elsewhere: "toallitas desmaquillantes" is the correct
        # name for makeup remover wipes, and banning it there was wrong.
        if scope and not any(k in en.lower() for k in scope):
            continue
        low = es.lower()
        for term, why in forbid.items():
            if term.lower() in low:
                bad.append("%s -> '%s' (%s)" % (en[:26], term, why))
        for key, want in req.items():
            if en.lower().startswith(key.lower()) and want.lower() not in low:
                bad.append("%s -> expected '%s'" % (en[:26], want))
    if bad:
        mark("fail", "Spanish matches the glossary", "%d: %s"
             % (len(bad), " | ".join(bad[:3])))
    else:
        mark("pass", "Spanish matches the glossary")

    # 7. the HD Supply warnings are still in the text
    body = "\n".join(c[1] + " " + c[2] for _, _, c in rows_of(doc))
    for label, needle in FLAGS_REQUIRED.get(name, []):
        if needle in body:
            mark("pass", "warning kept: " + label)
        else:
            mark("fail", "warning kept: " + label, "'%s' is gone" % needle)

def check_script(path):
    say("\n=== %s ===" % os.path.basename(path))
    if not os.path.exists(path):
        mark("fail", "file present", "not found")
        return
    src = open(path, encoding="utf-8").read()

    # The invariant the whole bar system rests on: it edits the existing
    # form and sheet by id. Anything that creates one would mint a new
    # URL and kill the QR code printed at the bar.
    creators = re.findall(r"(FormApp\.create\(|SpreadsheetApp\.create|DriveApp|makeCopy)", src)
    if creators:
        mark("fail", "creates no new form or sheet", str(set(creators)))
    else:
        mark("pass", "creates no new form or sheet", "QR stays valid")

    for needed in ("FormApp.openById", "SpreadsheetApp.openById"):
        mark("pass" if needed in src else "fail", "opens by id: " + needed)

    # formatDateShort must handle a real Date, or the nightly reminder
    # fires every night whether or not the count is in.
    if "[object Date]" in src:
        mark("pass", "formatDateShort handles a Date")
    else:
        mark("fail", "formatDateShort handles a Date", "reminder would always fire")

    n = len(re.findall(r"^function ", src, re.M))
    mark("pass", "top-level functions", str(n))

def main():
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    say("THE ELM - inventory check    %s" % stamp)
    glossary = json.load(open(os.path.join(ROOT, "bots", "glossary_es.json"),
                              encoding="utf-8"))
    for s in SHEETS:
        check_sheet(os.path.join(ROOT, s), glossary)
    check_script(os.path.join(ROOT, SCRIPT))

    say("\n" + "-" * 58)
    say("pass %d   warn %d   fail %d" % (results["pass"], results["warn"], results["fail"]))
    if results["fail"]:
        say("Something is wrong. Read the FAIL lines above before sending a sheet out.")
    else:
        say("All clear.")

    os.makedirs(LOGS, exist_ok=True)
    log = os.path.join(LOGS, "check-%s.log"
                       % datetime.datetime.now().strftime("%Y-%m-%d-%H%M"))
    with io.open(log, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print("\nlog: %s" % log)
    return 1 if results["fail"] else 0

if __name__ == "__main__":
    sys.exit(main())
