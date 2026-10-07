// ============================================================
// THE ELM BAR — BAR INVENTORY SYSTEM  (v5 — GRID)
//
// The bartender's form is Multiple Choice Grids: one grid per category,
// spirits as rows, answers as columns. Everything is tapped, nothing is
// typed — which is what ended the ambiguous "Same" entries that were
// corrupting the data. ~103 questions became ~24 items.
//
// SETUP (run once each, from the Run menu above):
//   1. convertFormToGridLayout()      build/refresh the grid form
//                                     (re-run if it reports a time budget stop)
//   2. listGridCoverage()             verify all 44 spirits are covered
//   3. installFormTrigger()           record submissions to the sheet
//   4. setupDashboardNow()            build the Manager Dashboard
//
// CHECK ANYTIME:
//   runDiagnostics()      overall health check
//   simulateFormSubmit()  fake submission, end to end
//
// Everything else in this file is internal and never needs to be run
// by hand. The form and sheet are always edited in place, so their
// links never change.
// ============================================================

const CONFIG = {
  MANAGER_EMAILS: [
    "agm@theelmhotel.com",
    "gm@theelmhotel.com",
    "rvenegas@csahg.com"
  ],

  LOGO_URL: "https://theelmhotel.com/elm-logo.png",
  HOTEL_NAME: "THE ELM, A RAMADA BY WYNDHAM",
  HOTEL_ADDRESS: "301 E Eldorado Parkway, Little Elm, Texas 75068",
  HOTEL_PHONE: "214-618-0700",

  DASHBOARD_NAME: "Manager Dashboard",

  LOW_STOCK_LEVELS: ["E", "1/8", "1/4"],
  // A bottle is only "low stock" if the OPEN bottle is low AND there are
  // fewer than this many unopened backups behind it. A low bottle with 2+
  // backups isn't a problem - it's just a bottle in use.
  LOW_STOCK_MAX_UNOPENED: 2,
  BOTTLE_OPTIONS: ["E", "1/8", "1/4", "1/2", "3/4", "Full"],

  ANALYSIS_WEEKS: 4,
  CHRONIC_THRESHOLD: 3,
  TREND_WEEKS: 8,
  MAX_HISTORY_WEEKS: 16,

  // NEW in v3: reject submission if >N spirits have no stock level answer
  MAX_MISSING_LEVELS_ALLOWED: 5,

  COLORS: {
    navy: "#1c2b35",
    blush: "#eccbc0",
    cream: "#fffaf6",
    sand: "#f5efe9",
    terracotta: "#b06a58",
    border: "#e5d8cc",
    muted: "#8a7264"
  },

  SHEET_COLORS: {
    empty: "#EF5350",
    veryLow: "#FF9800",
    low: "#FDD835",
    ok: "#81C784",
    notReported: "#BDBDBD",
    headerBg: "#1c2b35",
    colHeaderBg: "#3d5566",
    chronicBg: "#f0dccb",
    searchBg: "#fff9c4",
    flagBg: "#ffe0b2"
  },

  HELPER_START_COL: 30,
  HELPER_COL_COUNT: 5,

  DASHBOARD_MIN_REFRESH_INTERVAL_MINUTES: 60,
  MAX_MANAGER_EMAILS_PER_DAY: 40
};

const LEVEL_TO_FRACTION = {
  "E": 0, "1/8": 0.125, "1/4": 0.25, "3/8": 0.375, "1/2": 0.5,
  "5/8": 0.625, "3/4": 0.75, "7/8": 0.875, "Full": 1
};

const SPIRIT_CATEGORIES = {
  "Well Spirits": ["Sky Vodka", "Sauza Tequila", "Bacardi Superior", "Tanqueray", "Jim Beam", "Dewar's"],
  "Vodka": ["Tito's", "Grey Goose", "Ketel One"],
  "Premium Liqueurs": ["St-Germain", "Aperol", "Campari", "Ancho Reyes", "Grand Marnier", "Chambord", "Kahlua", "White Chocolate"],
  "Tequila / Mezcal": ["Casamigos Blanco", "Casamigos Reposado", "Don Julio Blanco", "Clase Azul", "Vida Mezcal"],
  "Rum": ["Bacardi Black", "Captain Morgan Spiced"],
  "Gin": ["Hendrick's", "Empress Indigo"],
  "Whiskey / Bourbon": ["Bulleit Bourbon", "Bulleit Rye", "Crown Royal", "Crown Royal Apple", "Jameson", "Jack Daniel's"],
  "Cognac": ["Hennessy VS", "Remy Martin VSOP"],
  "Well Liqueurs / Mixers": ["Blue Curacao", "Peach Schnapps", "Watermelon Schnapps", "Apple Pucker", "Cointreau", "Creme de Menthe", "Creme de Cacao", "Grenadine"],
  "Mixers & Syrups": ["Agave", "House Sour Mix"]
};

var _spiritCache = null;
function getAllSpirits() {
  if (_spiritCache === null) {
    _spiritCache = [];
    for (var key in SPIRIT_CATEGORIES) {
      _spiritCache = _spiritCache.concat(SPIRIT_CATEGORIES[key]);
    }
  }
  return _spiritCache;
}

function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty("spreadsheetId");
  if (!id) {
    throw new Error("No spreadsheetId in Script Properties. This script expects your existing sheet.");
  }
  return SpreadsheetApp.openById(id);
}

function getFormId() {
  var id = PropertiesService.getScriptProperties().getProperty("formId");
  if (!id) {
    throw new Error("No formId in Script Properties. Add it (from the form's edit URL) before installing the trigger.");
  }
  return id;
}

function getForm() {
  return FormApp.openById(getFormId());
}

function setupDashboardNow() {
  var ss = getSpreadsheet();
  ensureDashboard(ss);
  refreshDashboard(ss);
  Logger.log("Dashboard built: " + ss.getUrl());
}

function refreshDashboardNow() {
  refreshDashboard(getSpreadsheet());
  Logger.log("Dashboard refreshed.");
}

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu("Elm Bar")
      .addItem("Refresh Dashboard", "menuRefreshDashboard")
      .addItem("Open This Week's Tab", "menuOpenCurrentWeek")
      .addSeparator()
      .addItem("Send Test Entry", "sendTestEntryFromMenu")
      .addItem("Email Form Link to Managers", "emailFormLinkToManagers")
      .addSeparator()
      .addItem("Set Form to Tonight's Bottles", "rebuildNightlyForm")
      .addItem("Update Bartender Dropdown", "syncBartenderDropdown")
      .addItem("Send Reminder Now (if count missing)", "sendNightlyReminder")
      .addItem("Install Nightly Triggers", "installNightlyTriggers")
      .addToUi();
  } catch (e) {
    // Simple triggers cannot always show UI; never let this throw.
  }
}

function menuRefreshDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  refreshDashboard(ss);
  SpreadsheetApp.getUi().alert("Dashboard refreshed.");
}

function menuOpenCurrentWeek() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = getWeekRange(new Date()).name;
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    ss.setActiveSheet(sheet);
  } else {
    SpreadsheetApp.getUi().alert("No tab yet for " + name + ". It is created on the first submission of the week.");
  }
}

function listOnFormSubmitTriggers() {
  var all = ScriptApp.getProjectTriggers();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].getHandlerFunction() === "onFormSubmit") out.push(all[i]);
  }
  return out;
}


function installFormTrigger() {
  // Clear any existing onFormSubmit triggers first so re-running this
  // never stacks duplicates (which would double-record submissions).
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === "onFormSubmit") ScriptApp.deleteTrigger(existing[i]);
  }
  var form = getForm();
  ScriptApp.newTrigger("onFormSubmit")
    .forForm(form)
    .onFormSubmit()
    .create();
  Logger.log("Installed a fresh onFormSubmit trigger on: " + form.getTitle());
}

// ============================================================
// GRID LAYOUT (the form format)
//
// Rebuilds the spirit questions as Multiple Choice Grids: one grid per
// category, spirits as rows, answers as columns. ~103 scrolling
// questions become ~24 items, and nothing can be typed - which is what
// ended the "Same" problem for good.
//
// Keeps Date / Shift / Bartender / Notes untouched. Safe to re-run.
//
// TRADE-OFF: grids can't take typed values, so unopened counts above
// five record as "6+" rather than an exact number.
// ============================================================
// TIMEOUT SAFETY: Apps Script kills a run at 6 minutes. This conversion
// is ~220 API calls on a live form - bigger than the run that already
// timed out mid-operation tonight and silently deleted a question. So
// the work is done in ORDER (grids built before old questions are
// removed) and the function stops itself at GRID_TIME_BUDGET_MS with a
// clear "run me again" message. Re-running always resumes safely
// because every step checks what's actually there first.
const GRID_TIME_BUDGET_MS = 4 * 60 * 1000; // stop at 4 min, well clear of the 6 min kill

function gridCategoryChunks() {
  var out = [];
  for (var cat in SPIRIT_CATEGORIES) {
    var bottles = SPIRIT_CATEGORIES[cat];
    var chunks = [];
    for (var b = 0; b < bottles.length; b += GRID_MAX_ROWS) {
      chunks.push(bottles.slice(b, b + GRID_MAX_ROWS));
    }
    for (var ch = 0; ch < chunks.length; ch++) {
      out.push({
        category: cat,
        rows: chunks[ch],
        suffix: (chunks.length > 1) ? (" (" + (ch + 1) + " of " + chunks.length + ")") : ""
      });
    }
  }
  return out;
}

function convertFormToGridLayout() {
  var started = new Date().getTime();
  function outOfTime() { return (new Date().getTime() - started) > GRID_TIME_BUDGET_MS; }

  var form = getForm();
  var spirits = getAllSpirits();
  var chunks = gridCategoryChunks();

  var gridsMade = 0, removed = 0, skippedExisting = 0;
  var ranOut = false;

  // ---- PHASE 1: build any grids that don't exist yet. ----
  // Grids are created BEFORE anything is deleted, so if this run is
  // killed the form still holds every original question - no data path
  // is ever left with neither a grid nor its old questions.
  // Fetch the item list ONCE and track titles locally. Re-fetching per
  // chunk cost ~40 API round trips on a resume where nothing needed
  // building, which is most of why the first run burned its budget.
  var existingTitles = {};
  var snapshot = form.getItems();
  for (var t0 = 0; t0 < snapshot.length; t0++) {
    existingTitles[String(snapshot[t0].getTitle()).trim()] = true;
  }

  for (var i = 0; i < chunks.length; i++) {
    if (outOfTime()) { ranOut = true; break; }

    var ck = chunks[i];
    var lvlTitle = GRID_LEVEL_PREFIX + " - " + ck.category + ck.suffix;
    var unTitle = GRID_UNOPENED_PREFIX + " - " + ck.category + ck.suffix;

    if (!existingTitles[lvlTitle]) {
      var lvl = form.addGridItem();
      lvl.setTitle(lvlTitle);
      lvl.setHelpText("Tap the current fill level for each bottle.");
      lvl.setRows(ck.rows);
      lvl.setColumns(GRID_LEVEL_COLUMNS);
      lvl.setRequired(true);
      existingTitles[lvlTitle] = true;
      gridsMade++;
    } else {
      skippedExisting++;
    }

    if (!existingTitles[unTitle]) {
      var un = form.addGridItem();
      un.setTitle(unTitle);
      un.setHelpText('How many sealed backup bottles are in the back? Tap "6+" if more than five.');
      un.setRows(ck.rows);
      un.setColumns(GRID_UNOPENED_COLUMNS);
      un.setRequired(true);
      existingTitles[unTitle] = true;
      gridsMade++;
    } else {
      skippedExisting++;
    }
  }

  // ---- PHASE 2: only once ALL grids exist, remove what they replace. ----
  var allGridsPresent = true;
  for (var g = 0; g < chunks.length; g++) {
    if (!existingTitles[GRID_LEVEL_PREFIX + " - " + chunks[g].category + chunks[g].suffix] ||
        !existingTitles[GRID_UNOPENED_PREFIX + " - " + chunks[g].category + chunks[g].suffix]) {
      allGridsPresent = false;
      break;
    }
  }

  if (allGridsPresent) {
    var items = form.getItems();
    var deleteDeadline = started + (5 * 60 * 1000); // deletion may use up to 5 min
    for (var d = items.length - 1; d >= 0; d--) {
      if (new Date().getTime() > deleteDeadline) { ranOut = true; break; }
      var it = items[d];
      var t = String(it.getTitle()).trim();
      var isSpiritQ = spirits.indexOf(t) !== -1;
      var isUnopenedQ = t.slice(-" - Unopened".length) === " - Unopened";
      var isCategoryHeader = SPIRIT_CATEGORIES.hasOwnProperty(t);
      var isBlankQ = (t === "" &&
        (it.getType() === FormApp.ItemType.MULTIPLE_CHOICE || it.getType() === FormApp.ItemType.TEXT));
      if (isSpiritQ || isUnopenedQ || isCategoryHeader || isBlankQ) {
        form.deleteItem(it);
        removed++;
      }
    }
  }

  Logger.log("---- GRID LAYOUT BUILD ----");
  Logger.log("Grids created this run: " + gridsMade + " | already existed: " + skippedExisting);
  Logger.log("Old questions removed this run: " + removed);
  Logger.log("Form item count is now: " + form.getItems().length);

  if (ranOut || !allGridsPresent) {
    Logger.log("");
    Logger.log("*** TIME BUDGET REACHED - NOT FINISHED ***");
    Logger.log("Nothing is broken: run convertFormToGridLayout() again to continue");
    Logger.log("where it left off. Repeat until you see the FINISHED message.");
  } else {
    Logger.log("FINISHED. Verify with listGridCoverage(), then submit a test entry.");
  }
}

// Confirms every spirit appears exactly once in a level grid and once in
// an unopened grid - i.e. nothing got dropped or duplicated.
function listGridCoverage() {
  var form = getForm();
  var spirits = getAllSpirits();
  var lvlSeen = {}, unSeen = {};
  var items = form.getItems();

  for (var i = 0; i < items.length; i++) {
    if (items[i].getType() !== FormApp.ItemType.GRID) continue;
    var t = String(items[i].getTitle()).trim();
    var rows = items[i].asGridItem().getRows();
    var bucket = (t.indexOf(GRID_UNOPENED_PREFIX) === 0) ? unSeen : lvlSeen;
    Logger.log(t + "  ->  " + rows.length + " rows");
    for (var r = 0; r < rows.length; r++) {
      var rn = String(rows[r]).trim();
      bucket[rn] = (bucket[rn] || 0) + 1;
    }
  }

  var problems = 0;
  for (var s = 0; s < spirits.length; s++) {
    var sp = spirits[s];
    var l = lvlSeen[sp] || 0, u = unSeen[sp] || 0;
    if (l !== 1 || u !== 1) {
      Logger.log("PROBLEM: " + sp + " - level grids: " + l + ", unopened grids: " + u + " (each should be exactly 1)");
      problems++;
    }
  }
  if (problems === 0) {
    Logger.log("All " + spirits.length + " spirits appear exactly once in a level grid and once in an unopened grid.");
  } else {
    Logger.log(problems + " spirit(s) need attention - re-run convertFormToGridLayout().");
  }
}

// ---- Grid layout ----
// Grid titles carry the category so managers can tell them apart in the
// form and in the raw responses. The prefixes below are how onFormSubmit
// tells a level grid from an unopened grid, so DON'T change them without
// changing the parser.
const GRID_LEVEL_PREFIX = "Stock Level";
const GRID_UNOPENED_PREFIX = "Unopened Count";
// v6: six columns, not nine, and deliberately UNEVENLY spaced.
// Nine needed a sideways scroll on a phone for every row. But an even
// five was wrong too: the reorder decision lives entirely at the bottom
// of the bottle. Nobody orders differently for 3/4 versus 5/8; everybody
// orders differently for 1/8 versus 1/4. So the scale is fine near empty
// and coarse up top - and it has no comfortable middle button to tap.
// LEVEL_TO_FRACTION still knows all nine so earlier weeks still read.
const GRID_LEVEL_COLUMNS = ["E", "1/8", "1/4", "1/2", "3/4", "Full"];
const GRID_UNOPENED_COLUMNS = ["0", "1", "2", "3", "4", "5", "6+"];
// Google's grids get cramped on a phone past ~8 rows, so long categories
// are split into multiple grids ("Premium Liqueurs (1 of 2)").
const GRID_MAX_ROWS = 8;
// Valid unopened answers at recording time. Matches the grid columns;
// plain numbers are also accepted so older typed submissions still read
// correctly.
const UNOPENED_CHOICES = GRID_UNOPENED_COLUMNS;


// Finds the current index of the first item whose title matches
// exactly, in a FRESH items snapshot. Returns -1 if not found.
function findItemIndexByTitle(items, title) {
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].getTitle()).trim() === title) return i;
  }
  return -1;
}




// Quick sanity check: lists every Unopened-question's current type
// and choices, so you can confirm the conversion took effect without
// having to click through 44 questions in the form UI.
// ============================================================
// NIGHTLY SUBMISSION REMINDER  (NEW in v4 — for adoption, not data)
//
// The fastest form in the world doesn't help if nobody opens it. This
// adds a once-a-night check: if today's PM shift hasn't been logged
// by a set time, managers get one email nudge. No new integrations
// needed - it reuses the same Gmail send path already used for
// low-stock alerts.
//
// This does NOT text or email the bartender directly (no bartender
// contact info is stored anywhere in this system) - it tells
// managers so a manager can do the in-person nudge, which is what
// actually builds the habit early on.
// ============================================================





function runDiagnostics() {
  Logger.log("---- ELM BAR INVENTORY: DIAGNOSTICS ----");

  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty("spreadsheetId");
  var formId = props.getProperty("formId");

  Logger.log("spreadsheetId property: " + (sheetId || "MISSING"));
  Logger.log("formId property: " + (formId || "MISSING - add this before installing the trigger"));

  if (sheetId) {
    try {
      var ss = SpreadsheetApp.openById(sheetId);
      Logger.log("Spreadsheet OK: " + ss.getName() + " -> " + ss.getUrl());
    } catch (e) {
      Logger.log("Spreadsheet FAILED to open: " + e);
    }
  }

  if (formId) {
    try {
      var form = FormApp.openById(formId);
      Logger.log("Form OK: " + form.getTitle());
      var items = form.getItems();
      Logger.log("Form has " + items.length + " questions.");
      var titles = [];
      for (var i = 0; i < items.length; i++) titles.push(items[i].getTitle());
      Logger.log("Question titles: " + titles.join(" | "));

      // A spirit is covered if it's a GRID ROW (the current layout) or a
      // standalone question title (the old per-bottle layout). Checking
      // only titles would falsely flag all 44 on a grid form.
      var spirits = getAllSpirits();
      var covered = {};
      for (var t = 0; t < titles.length; t++) covered[String(titles[t]).trim()] = true;
      for (var gi = 0; gi < items.length; gi++) {
        if (items[gi].getType() !== FormApp.ItemType.GRID) continue;
        var gRows = items[gi].asGridItem().getRows();
        for (var gr = 0; gr < gRows.length; gr++) covered[String(gRows[gr]).trim()] = true;
      }
      var missing = [];
      for (var s = 0; s < spirits.length; s++) {
        if (!covered[spirits[s]]) missing.push(spirits[s]);
      }
      if (missing.length > 0) {
        Logger.log("WARNING: these spirits appear nowhere on the form (not as a question, not as a grid row): " + missing.join(", "));
        Logger.log("Run convertFormToGridLayout() to rebuild, or fix the names in SPIRIT_CATEGORIES.");
      } else {
        Logger.log("All " + spirits.length + " spirits are covered by the form. Good.");
      }
    } catch (e) {
      Logger.log("Form FAILED to open: " + e);
    }
  }

  var triggers = listOnFormSubmitTriggers();
  Logger.log("onFormSubmit triggers currently installed: " + triggers.length);

  var usedToday = parseInt(props.getProperty(getTodayEmailCountKey()) || "0", 10);
  Logger.log("Manager emails sent today: " + usedToday + " / " + CONFIG.MAX_MANAGER_EMAILS_PER_DAY);

  var lastRun = parseInt(props.getProperty("lastDashboardRefreshMs") || "0", 10);
  Logger.log("Dashboard last auto-refreshed: " + (lastRun ? new Date(lastRun).toLocaleString() : "never yet") +
    " (throttle: " + CONFIG.DASHBOARD_MIN_REFRESH_INTERVAL_MINUTES + " min)");

  // Report the form's grid layout state.
  if (formId) {
    try {
      var checkForm = FormApp.openById(formId);
      var checkItems = checkForm.getItems();
      var gridCount = 0, perBottleLeftovers = 0;
      var spiritList = getAllSpirits();
      for (var ci = 0; ci < checkItems.length; ci++) {
        var ciTitle = String(checkItems[ci].getTitle()).trim();
        if (checkItems[ci].getType() === FormApp.ItemType.GRID) gridCount++;
        else if (spiritList.indexOf(ciTitle) !== -1 ||
                 ciTitle.slice(-" - Unopened".length) === " - Unopened") perBottleLeftovers++;
      }
      Logger.log("Grid questions: " + gridCount + " | leftover per-bottle questions: " + perBottleLeftovers);
      if (perBottleLeftovers > 0) {
        Logger.log("Run convertFormToGridLayout() to finish the grid conversion.");
      }
    } catch (e) {
      // Already logged the form-open failure above; nothing more to add.
    }
  }

  Logger.log("---- END DIAGNOSTICS ----");
}


// Builds a fake submission from the REAL current form, so it exercises
// whatever the form actually is right now (grids included) rather than
// an assumed layout. Records a "TEST - Diagnostics" column you can
// delete afterward.
function simulateFormSubmit() {
  var form = getForm();
  var formItems = form.getItems();
  var fakeItems = [];

  function fakeSimple(title, value) {
    return {
      getItem: function () {
        return {
          getTitle: function () { return title; },
          getType: function () { return FormApp.ItemType.TEXT; }
        };
      },
      getResponse: function () { return value; }
    };
  }

  fakeItems.push(fakeSimple("Date", Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "America/Chicago", "MM/dd")));
  fakeItems.push(fakeSimple("Shift", "PM"));
  fakeItems.push(fakeSimple("Bartender Name", "TEST - Diagnostics"));
  fakeItems.push(fakeSimple("Notes", "Simulated test submission. Safe to delete this column."));

  var gridsSeen = 0, singlesSeen = 0;

  for (var i = 0; i < formItems.length; i++) {
    var item = formItems[i];
    var title = String(item.getTitle()).trim();
    var lower = title.toLowerCase();

    // Skip the meta questions - already faked above.
    if (lower.indexOf("date") === 0 || lower.indexOf("shift") === 0 ||
        lower.indexOf("bartender") === 0 || lower.indexOf("notes") === 0) continue;

    if (item.getType() === FormApp.ItemType.GRID) {
      var gItem = item.asGridItem();
      var rows = gItem.getRows();
      var isUnopened = (title.indexOf(GRID_UNOPENED_PREFIX) === 0);
      var rowAnswers = [];
      for (var r = 0; r < rows.length; r++) {
        rowAnswers.push(isUnopened ? "1" : "1/2");
      }
      // Real grid item responses carry the grid item itself, so the
      // parser can read its rows - mirror that exactly.
      fakeItems.push({
        getItem: (function (captured) {
          return function () { return captured; };
        })(item),
        getResponse: (function (captured) {
          return function () { return captured; };
        })(rowAnswers)
      });
      gridsSeen++;
      continue;
    }

    // Per-bottle question (only present if the form isn't fully grid yet)
    var spiritsList = getAllSpirits();
    var isUnopenedQ = title.slice(-" - Unopened".length) === " - Unopened";
    if (spiritsList.indexOf(title) !== -1) {
      fakeItems.push(fakeSimple(title, "1/2"));
      singlesSeen++;
    } else if (isUnopenedQ) {
      fakeItems.push(fakeSimple(title, "1"));
      singlesSeen++;
    }
  }

  Logger.log("Simulating against the live form: " + gridsSeen + " grid(s), " +
    singlesSeen + " per-bottle question(s).");

  onFormSubmit({
    response: { getItemResponses: function () { return fakeItems; } }
  });

  Logger.log("Simulated submission processed. Check the current week's tab and your email.");
}

function columnToLetter(column) {
  var letter = "";
  while (column > 0) {
    var rem = (column - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    column = Math.floor((column - rem) / 26);
  }
  return letter;
}

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  var m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})/);
  return m ? m[1] + "/" + m[2] : String(dateStr).trim();
}

function describeLevel(level) {
  if (level === "E") return "Empty";
  if (level === "Full") return "Full";
  return level ? level + " full" : "Not reported";
}

function getLevelColor(level) {
  if (level === "E") return CONFIG.SHEET_COLORS.empty;
  if (level === "1/8") return CONFIG.SHEET_COLORS.veryLow;
  if (level === "1/4") return CONFIG.SHEET_COLORS.low;
  if (["1/2", "5/8", "3/4", "7/8", "Full"].indexOf(level) !== -1) return CONFIG.SHEET_COLORS.ok;
  if (!level) return CONFIG.SHEET_COLORS.notReported;
  return "#FFFFFF";
}

function ensureCapacity(sheet, neededRows, neededCols) {
  var maxRows = sheet.getMaxRows();
  if (neededRows > maxRows) sheet.insertRowsAfter(maxRows, neededRows - maxRows);
  var maxCols = sheet.getMaxColumns();
  if (neededCols > maxCols) sheet.insertColumnsAfter(maxCols, neededCols - maxCols);
}

var WEEK_NAME_PATTERN = /^(\d{2})\/(\d{2}) - (\d{2})\/(\d{2})$/;

function weekNameToTimestamp(name) {
  var m = String(name).match(WEEK_NAME_PATTERN);
  if (!m) return 0;
  var month = parseInt(m[1], 10) - 1;
  var day = parseInt(m[2], 10);
  var now = new Date();
  var candidate = new Date(now.getFullYear(), month, day);
  if (candidate.getTime() - now.getTime() > 45 * 86400000) {
    candidate = new Date(now.getFullYear() - 1, month, day);
  }
  return candidate.getTime();
}

function getAllWeekSheets(ss) {
  return ss.getSheets()
    .filter(function (s) { return WEEK_NAME_PATTERN.test(s.getName()); })
    .sort(function (a, b) {
      return weekNameToTimestamp(b.getName()) - weekNameToTimestamp(a.getName());
    });
}

function getWeekRange(referenceDate) {
  var today = new Date(referenceDate);
  var dow = today.getDay();
  var weekEnd = new Date(today);

  if (dow === 1) {
    weekEnd.setDate(today.getDate());
  } else {
    weekEnd.setDate(today.getDate() + ((8 - dow) % 7));
  }

  var weekStart = new Date(weekEnd);
  weekStart.setDate(weekEnd.getDate() - 6);

  function pad(n) { return String(n).length < 2 ? "0" + n : String(n); }

  var name = pad(weekStart.getMonth() + 1) + "/" + pad(weekStart.getDate()) +
    " - " + pad(weekEnd.getMonth() + 1) + "/" + pad(weekEnd.getDate());

  return { name: name, weekStart: weekStart, weekEnd: weekEnd };
}

function readPreviousPars(ss, currentName, spiritCount) {
  var weeks = getAllWeekSheets(ss);
  for (var i = 0; i < weeks.length; i++) {
    var prev = weeks[i];
    if (prev.getName() === currentName) continue;
    if (prev.getLastRow() < 2) continue;

    var rows = Math.min(spiritCount, prev.getLastRow() - 1);
    var pars = prev.getRange(2, 2, rows, 1).getValues();

    var hasAny = false;
    for (var p = 0; p < pars.length; p++) {
      if (pars[p][0] !== "" && pars[p][0] !== null) { hasAny = true; break; }
    }
    if (!hasAny) continue;

    while (pars.length < spiritCount) pars.push([""]);
    return { values: pars, source: prev.getName() };
  }
  return null;
}

function getWeekSheet(ss) {
  var spirits = getAllSpirits();
  var info = getWeekRange(new Date());

  var existing = ss.getSheetByName(info.name);
  if (existing) return existing;

  var dash = ss.getSheetByName(CONFIG.DASHBOARD_NAME);
  var insertAt = (dash && ss.getSheets().indexOf(dash) === 0) ? 1 : 0;
  var sheet = ss.insertSheet(info.name, insertAt);

  sheet.getRange(1, 1, 1, 2)
       .setValues([["Bottle", "Par Level"]])
       .setFontWeight("bold")
       .setBackground(CONFIG.SHEET_COLORS.headerBg)
       .setFontColor("#FFFFFF")
       .setFontSize(11)
       .setVerticalAlignment("middle");

  var names = [];
  for (var i = 0; i < spirits.length; i++) names.push([spirits[i]]);

  sheet.getRange(2, 1, names.length, 1)
       .setValues(names)
       .setFontSize(10)
       .setVerticalAlignment("middle");

  var carried = readPreviousPars(ss, info.name, spirits.length);
  if (carried) {
    sheet.getRange(2, 2, spirits.length, 1).setValues(carried.values);
    Logger.log("Par levels carried forward from " + carried.source);
  }

  sheet.getRange(spirits.length + 3, 1)
       .setValue("Shift Notes")
       .setFontWeight("bold")
       .setBackground(CONFIG.SHEET_COLORS.headerBg)
       .setFontColor("#FFFFFF");

  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 110);
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setRowHeight(1, 42);

  Logger.log("Created weekly tab: " + info.name);
  return sheet;
}

function readCurrentPars(ss) {
  var spirits = getAllSpirits();
  var name = getWeekRange(new Date()).name;
  var sheet = ss.getSheetByName(name);
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;

  var rows = Math.min(spirits.length, sheet.getLastRow() - 1);
  var names = sheet.getRange(2, 1, rows, 1).getValues();
  var pars = sheet.getRange(2, 2, rows, 1).getValues();

  for (var i = 0; i < rows; i++) {
    var v = pars[i][0];
    if (v !== "" && v !== null) out[names[i][0]] = v;
  }
  return out;
}

function getTodayEmailCountKey() {
  var tz = Session.getScriptTimeZone() || "America/Chicago";
  return "emailCount_" + Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
}

function canSendMoreManagerEmailsToday(numToSend) {
  var props = PropertiesService.getScriptProperties();
  var key = getTodayEmailCountKey();
  var used = parseInt(props.getProperty(key) || "0", 10);
  return (used + numToSend) <= CONFIG.MAX_MANAGER_EMAILS_PER_DAY;
}

function recordManagerEmailsSent(numSent) {
  var props = PropertiesService.getScriptProperties();
  var key = getTodayEmailCountKey();
  var used = parseInt(props.getProperty(key) || "0", 10);
  props.setProperty(key, String(used + numSent));
}

function sendManagerEmails(subject, plain, html) {
  var recipients = CONFIG.MANAGER_EMAILS;

  if (!canSendMoreManagerEmailsToday(recipients.length)) {
    Logger.log("Manager email quota (" + CONFIG.MAX_MANAGER_EMAILS_PER_DAY +
      "/day) reached - skipping send for: " + subject +
      ". The submission itself was still recorded normally.");
    return;
  }

  var sentCount = 0;
  for (var i = 0; i < recipients.length; i++) {
    try {
      GmailApp.sendEmail(recipients[i], subject, plain, { htmlBody: html });
      sentCount++;
    } catch (err) {
      Logger.log("Email failed for " + recipients[i] + ": " + err);
    }
  }
  recordManagerEmailsSent(sentCount);
}

function sendDuplicateAlert(date, shift, bartender, sheetUrl) {
  var subject = "Elm Bar Inventory - DUPLICATE blocked (" + date + " " + shift + ")";
  var body = "A second submission for an already-recorded shift was blocked.\n\n" +
    "Date: " + date + "\nShift: " + shift + "\nBartender: " + bartender + "\n\n" +
    "The original entry was kept. Nothing was overwritten.\n\n" + sheetUrl;

  if (!canSendMoreManagerEmailsToday(CONFIG.MANAGER_EMAILS.length)) {
    Logger.log("Manager email quota reached - skipping duplicate alert for: " + subject);
    return;
  }

  var sentCount = 0;
  for (var i = 0; i < CONFIG.MANAGER_EMAILS.length; i++) {
    try {
      GmailApp.sendEmail(CONFIG.MANAGER_EMAILS[i], subject, body);
      sentCount++;
    } catch (e) {
      Logger.log("Duplicate alert failed: " + e);
    }
  }
  recordManagerEmailsSent(sentCount);
}

function buildEmailHtml(date, shift, bartender, lowStockItems, notes, sheetUrl, missingSpirits, missingLevels, invalidUnopened) {
  var C = CONFIG.COLORS;
  missingSpirits = missingSpirits || [];
  missingLevels = missingLevels || [];
  invalidUnopened = invalidUnopened || [];

  function detailRow(label, value, isLast) {
    return '<tr><td style="padding:15px 20px;' +
      (isLast ? "" : " border-bottom:1px solid " + C.border + ";") + '">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:' + C.muted + ';">' + label + '</td>' +
      '<td style="font-size:15px; color:' + C.navy + '; text-align:right; font-weight:700;">' + escapeHtml(value) + '</td>' +
      '</tr></table></td></tr>';
  }

  var alertSection;
  if (lowStockItems.length > 0) {
    var rows = "";
    for (var i = 0; i < lowStockItems.length; i++) {
      var border = (i === lowStockItems.length - 1) ? "" : " border-bottom:1px solid rgba(92,61,46,0.14);";
      rows += '<tr><td style="font-size:14px; color:#5c3d2e; padding:7px 0;' + border + '">' +
        escapeHtml(lowStockItems[i]) + '</td></tr>';
    }
    alertSection =
      '<tr><td style="padding:18px 30px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0dccb; border-left:5px solid ' + C.terracotta + '; border-radius:8px;">' +
      '<tr><td style="padding:15px 20px 6px 20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#8a4a38;">' +
      'Low Stock Alert &mdash; ' + lowStockItems.length + ' Item' + (lowStockItems.length === 1 ? "" : "s") +
      '</td></tr>' +
      '<tr><td style="padding:0 20px 16px 20px;"><table width="100%" cellpadding="0" cellspacing="0">' + rows + '</table></td></tr>' +
      '</table></td></tr>';
  } else {
    alertSection =
      '<tr><td style="padding:18px 30px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#dfe9dc; border-left:5px solid #6b8f5e; border-radius:8px;">' +
      '<tr><td style="padding:15px 20px 6px 20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#3d5c32;">All Items In Stock</td></tr>' +
      '<tr><td style="padding:0 20px 16px 20px; font-size:14px; color:#3d5c32;">No low stock items to report for this shift.</td></tr>' +
      '</table></td></tr>';
  }

  var missingSection = "";
  if (missingSpirits.length > 0) {
    var mRows = "";
    for (var mi = 0; mi < missingSpirits.length; mi++) {
      var mBorder = (mi === missingSpirits.length - 1) ? "" : " border-bottom:1px solid rgba(92,61,46,0.14);";
      mRows += '<tr><td style="font-size:13px; color:#5c4a2e; padding:6px 0;' + mBorder + '">' +
        escapeHtml(missingSpirits[mi]) + '</td></tr>';
    }
    missingSection =
      '<tr><td style="padding:0 30px 18px 30px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff3cd; border-left:5px solid #b08a3e; border-radius:8px;">' +
      '<tr><td style="padding:15px 20px 6px 20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#7a5c1e;">' +
      '\u26A0 No Answer Recorded &mdash; ' + missingSpirits.length + ' Item' + (missingSpirits.length === 1 ? "" : "s") +
      '</td></tr>' +
      '<tr><td style="padding:0 20px 10px 20px; font-size:12px; color:#7a5c1e;">Likely a form question title mismatch. These were left blank on the sheet.</td></tr>' +
      '<tr><td style="padding:0 20px 16px 20px;"><table width="100%" cellpadding="0" cellspacing="0">' + mRows + '</table></td></tr>' +
      '</table></td></tr>';
  }

  var missingLevelSection = "";
  if (missingLevels.length > 0) {
    var mlRows = "";
    for (var ml = 0; ml < missingLevels.length; ml++) {
      var mlBorder = (ml === missingLevels.length - 1) ? "" : " border-bottom:1px solid rgba(92,61,46,0.14);";
      mlRows += '<tr><td style="font-size:13px; color:#742c00; padding:6px 0;' + mlBorder + '">' +
        escapeHtml(missingLevels[ml]) + '</td></tr>';
    }
    missingLevelSection =
      '<tr><td style="padding:0 30px 18px 30px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffcccc; border-left:5px solid #d32f2f; border-radius:8px;">' +
      '<tr><td style="padding:15px 20px 6px 20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#c62828;">' +
      '\u26A0\uFE0F INCOMPLETE: NO STOCK LEVEL &mdash; ' + missingLevels.length + ' Item' + (missingLevels.length === 1 ? "" : "s") +
      '</td></tr>' +
      '<tr><td style="padding:0 20px 10px 20px; font-size:12px; color:#742c00;">These items were submitted WITHOUT selecting a stock level (E, 1/8, 1/2, Full, etc.). They appear as gray "Not Reported" on the sheet. Bartender should re-submit with actual levels.</td></tr>' +
      '<tr><td style="padding:0 20px 16px 20px;"><table width="100%" cellpadding="0" cellspacing="0">' + mlRows + '</table></td></tr>' +
      '</table></td></tr>';
  }

  var invalidSection = "";
  if (invalidUnopened.length > 0) {
    var ivRows = "";
    for (var iv = 0; iv < invalidUnopened.length; iv++) {
      var ivBorder = (iv === invalidUnopened.length - 1) ? "" : " border-bottom:1px solid rgba(92,61,46,0.14);";
      ivRows += '<tr><td style="font-size:13px; color:#7a5c1e; padding:6px 0;' + ivBorder + '">' +
        escapeHtml(invalidUnopened[iv]) + '</td></tr>';
    }
    invalidSection =
      '<tr><td style="padding:0 30px 18px 30px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff3cd; border-left:5px solid #b08a3e; border-radius:8px;">' +
      '<tr><td style="padding:15px 20px 6px 20px; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#7a5c1e;">' +
      '\u26A0 Typed Unopened Answers &mdash; ' + invalidUnopened.length + ' Item' + (invalidUnopened.length === 1 ? "" : "s") +
      '</td></tr>' +
      '<tr><td style="padding:0 20px 10px 20px; font-size:12px; color:#7a5c1e;">These answers were recorded as "?". Unopened counts must be tapped: 0-5 or 6+. Please remind the bartender.</td></tr>' +
      '<tr><td style="padding:0 20px 16px 20px;"><table width="100%" cellpadding="0" cellspacing="0">' + ivRows + '</table></td></tr>' +
      '</table></td></tr>';
  }

  var notesSection = "";
  if (notes) {
    notesSection =
      '<tr><td style="padding:0 30px 18px 30px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.sand + '; border-radius:8px;">' +
      '<tr><td style="padding:15px 20px 6px 20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:' + C.muted + ';">Shift Notes</td></tr>' +
      '<tr><td style="padding:0 20px 15px 20px; font-size:14px; color:' + C.navy + '; line-height:1.5;">' + escapeHtml(notes) + '</td></tr>' +
      '</table></td></tr>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>' +
    '<body style="margin:0; padding:20px; background:' + C.blush + '; font-family: Arial, Helvetica, sans-serif;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:' + C.cream + '; border-radius:14px; overflow:hidden;">' +
    '<tr><td style="background:#ffffff; padding:38px 30px 30px 30px; text-align:center;">' +
    '<img src="' + CONFIG.LOGO_URL + '" alt="The Elm" width="150" style="width:150px; max-width:150px; height:auto; display:block; margin:0 auto;">' +
    '</td></tr>' +
    '<tr><td style="background:' + C.navy + '; padding:14px 30px; text-align:center;">' +
    '<div style="color:' + C.blush + '; font-size:12px; letter-spacing:2px; text-transform:uppercase; font-weight:700;">Bar Inventory &mdash; Management Notice</div>' +
    '</td></tr>' +
    '<tr><td style="padding:32px 30px 8px 30px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.sand + '; border-radius:8px;">' +
    detailRow("Date", date, false) +
    detailRow("Shift", shift, false) +
    detailRow("Bartender", bartender, true) +
    '</table></td></tr>' +
    alertSection +
    missingLevelSection +
    invalidSection +
    missingSection +
    notesSection +
    '<tr><td style="padding:12px 30px 38px 30px; text-align:center;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>' +
    '<td bgcolor="' + C.navy + '" style="border-radius:6px;">' +
    '<a href="' + sheetUrl + '" style="display:inline-block; padding:15px 34px; font-family:Arial,sans-serif; font-size:14px; font-weight:700; color:#ffffff !important; text-decoration:none; border-radius:6px; letter-spacing:0.3px;">View Full Inventory Sheet</a>' +
    '</td></tr></table></td></tr>' +
    '<tr><td style="background:' + C.sand + '; padding:22px 30px; text-align:center; border-top:1px solid ' + C.border + ';">' +
    '<div style="font-size:11px; color:' + C.muted + '; font-weight:700; letter-spacing:1.5px;">' + CONFIG.HOTEL_NAME + '</div>' +
    '<div style="font-size:11px; color:#9a8477; margin-top:6px;">' + CONFIG.HOTEL_ADDRESS + '</div>' +
    '<div style="font-size:11px; color:#9a8477; margin-top:2px;">' + CONFIG.HOTEL_PHONE + '</div>' +
    '<div style="font-size:10px; color:#b5a79b; margin-top:12px;">Automated notification &mdash; do not reply.</div>' +
    '</td></tr></table></body></html>';
}

function buildPlainText(date, shift, bartender, lowStockItems, notes, sheetUrl, missingSpirits, missingLevels, invalidUnopened) {
  missingSpirits = missingSpirits || [];
  missingLevels = missingLevels || [];
  invalidUnopened = invalidUnopened || [];
  var t = "THE ELM - BAR INVENTORY\nManagement Notice\n\n";
  t += "Date: " + date + "\nShift: " + shift + "\nBartender: " + bartender + "\n\n";

  if (lowStockItems.length > 0) {
    t += "LOW STOCK ALERT (" + lowStockItems.length + " items):\n";
    for (var i = 0; i < lowStockItems.length; i++) t += "  - " + lowStockItems[i] + "\n";
  } else {
    t += "All items in stock.\n";
  }

  if (missingLevels.length > 0) {
    t += "\nINCOMPLETE - NO STOCK LEVEL (" + missingLevels.length + " items):\n";
    for (var ml = 0; ml < missingLevels.length; ml++) t += "  - " + missingLevels[ml] + "\n";
    t += "These need a re-submission with actual levels selected.\n";
  }

  if (missingSpirits.length > 0) {
    t += "\nWARNING - NO ANSWER RECORDED (" + missingSpirits.length + " items, likely a form title mismatch):\n";
    for (var mi = 0; mi < missingSpirits.length; mi++) t += "  - " + missingSpirits[mi] + "\n";
  }

  if (invalidUnopened.length > 0) {
    t += "\nWARNING - TYPED UNOPENED ANSWERS (" + invalidUnopened.length + " items, recorded as ?):\n";
    for (var iu = 0; iu < invalidUnopened.length; iu++) t += "  - " + invalidUnopened[iu] + "\n";
    t += "Unopened counts must be tapped: 0-5 or 6+. Typed answers are not accepted. Please remind the bartender.\n";
  }

  if (notes) t += "\nShift Notes:\n" + notes + "\n";
  t += "\nView full inventory: " + sheetUrl + "\n\n";
  t += CONFIG.HOTEL_NAME + "\n" + CONFIG.HOTEL_ADDRESS + "\n" + CONFIG.HOTEL_PHONE + "\n";
  t += "Automated notification - do not reply.\n";
  return t;
}

function onFormSubmit(e) {
  if (!e || !e.response) {
    Logger.log("onFormSubmit needs a real submission. For manual tests use simulateFormSubmit().");
    return;
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    Logger.log("Lock timeout - submission skipped.");
    return;
  }

  try {
    var spirits = getAllSpirits();
    var ss = getSpreadsheet();

    var answers = {};
    var date = "", shift = "", bartender = "", notes = "";

    var items = e.response.getItemResponses();
    for (var i = 0; i < items.length; i++) {
      var respItem = items[i].getItem();
      var rawTitle = respItem.getTitle();
      var title = String(rawTitle).trim();
      var value = items[i].getResponse();
      var lower = title.toLowerCase();

      // GRID questions answer for MANY spirits at once: one item response
      // whose value is an ARRAY, one entry per row, in the row order
      // defined on the item. Flatten it into the same per-spirit shape
      // the rest of this function expects, so grid and one-question-per-
      // bottle forms both work with no other changes.
      // Defensive: read the type only if the object actually exposes it,
      // and fall back to the shape of the answer (a grid's response is an
      // ARRAY, nothing else's is). Real Apps Script items always have
      // getType(), but this keeps a simulated or unusual response object
      // from taking down a real submission.
      var isGrid = false;
      if (typeof respItem.getType === "function") {
        isGrid = (respItem.getType() === FormApp.ItemType.GRID);
      } else {
        isGrid = Object.prototype.toString.call(value) === "[object Array]";
      }

      if (isGrid && typeof respItem.asGridItem === "function") {
        var gridRows = respItem.asGridItem().getRows();
        var isUnopenedGrid = (title.indexOf(GRID_UNOPENED_PREFIX) === 0);
        for (var g = 0; g < gridRows.length; g++) {
          var rowSpirit = String(gridRows[g]).trim();
          var rowAnswer = (value && value[g] != null) ? String(value[g]).trim() : "";
          if (rowAnswer === "") continue; // unanswered row -> treated as missing downstream
          answers[isUnopenedGrid ? (rowSpirit + " - Unopened") : rowSpirit] = rowAnswer;
        }
        continue;
      }

      if (lower.indexOf("date") === 0) date = value;
      else if (lower.indexOf("shift") === 0) shift = value;
      else if (lower.indexOf("bartender") === 0) bartender = value;
      else if (lower.indexOf("notes") === 0) notes = value;
      else answers[title] = value;
    }

    ensureDashboard(ss);
    var sheet = getWeekSheet(ss);

    var headerText = formatDateShort(date) + " " + shift + "\n" + bartender;

    var lastCol = sheet.getLastColumn();
    if (lastCol >= 3) {
      var existing = sheet.getRange(1, 3, 1, lastCol - 2).getValues()[0];
      for (var h = 0; h < existing.length; h++) {
        if (String(existing[h]).trim() === headerText.trim()) {
          Logger.log("Duplicate blocked: " + headerText.replace("\n", " "));
          sendDuplicateAlert(date, shift, bartender, ss.getUrl());
          return;
        }
      }
    }

    var values = [];
    var colors = [];
    var lowStock = [];
    var missingSpirits = [];
    var missingLevels = [];  // NEW in v3
    var invalidUnopened = []; // answers that aren't one of the tap choices

    for (var s = 0; s < spirits.length; s++) {
      var spirit = spirits[s];
      var level = answers[spirit] || "";
      var unopened = String(answers[spirit + " - Unopened"] || "").trim();

      // Backstop: any number is valid (the form's own validation already
      // blocks non-numbers at entry, so this only matters if validation
      // is ever removed by a manual form edit). Junk records as "?" and
      // gets flagged to managers by name. Old tap values like "6+" also
      // pass, so historical/mixed submissions never get falsely flagged.
      if (unopened !== "" && !/^\d+(\.\d+)?$/.test(unopened) && UNOPENED_CHOICES.indexOf(unopened) === -1) {
        invalidUnopened.push(spirit + ' (typed: "' + unopened + '")');
        unopened = "?";
      }

      if (!level) {
        missingLevels.push(spirit);
      }

      if (!answers.hasOwnProperty(spirit)) {
        missingSpirits.push(spirit);
      }

      values.push([unopened ? level + " - " + unopened : level]);
      colors.push([getLevelColor(level)]);

      // Alert only when the open bottle is low AND backups are short.
      // "6+" and any number >= LOW_STOCK_MAX_UNOPENED means well stocked.
      // "?" or blank counts as 0 backups (unknown = assume none, so it
      // gets flagged rather than silently ignored).
      if (CONFIG.LOW_STOCK_LEVELS.indexOf(level) !== -1) {
        var backupCount;
        if (unopened === "6+") backupCount = 6;
        else if (/^\d+$/.test(unopened)) backupCount = parseInt(unopened, 10);
        else backupCount = 0;

        if (backupCount < CONFIG.LOW_STOCK_MAX_UNOPENED) {
          lowStock.push(spirit + " \u2014 " + describeLevel(level) + ", " + backupCount + " unopened");
        }
      }
    }

    // v6: a count where nearly every bottle reads the same is not a count.
    // 09/18 arrived with all 44 bottles at 1/2 and the word "Same" typed in
    // every backup field. It gets recorded - throwing it away would just
    // hide the behaviour - but it is flagged so nobody treats it as real.
    var straightLine = null;
    try {
      var levelsOnly = [];
      for (var sl = 0; sl < spirits.length; sl++) {
        if (answers[spirits[sl]]) levelsOnly.push(String(answers[spirits[sl]]).trim());
      }
      straightLine = detectStraightLine(levelsOnly);
      if (straightLine) {
        Logger.log("STRAIGHT-LINE SUSPECTED: " + straightLine.count + "/" + straightLine.total +
                   ' bottles all read "' + straightLine.value + '"');
      }
    } catch (slErr) {
      Logger.log("Straight-line check skipped: " + slErr);
    }

    // v6: remember who counted, so the nightly reminder has somewhere to go.
    try {
      rememberBartender(ss, bartender, answers["Email"] || answers["email"] || "");
    } catch (rosterErr) {
      Logger.log("Roster update skipped (submission is intact): " + rosterErr);
    }

    // NEW in v3: reject if too many missing levels
    if (missingLevels.length > CONFIG.MAX_MISSING_LEVELS_ALLOWED) {
      Logger.log("SUBMISSION REJECTED: " + missingLevels.length + " items missing stock levels (max allowed: " + CONFIG.MAX_MISSING_LEVELS_ALLOWED + ")");
      sendManagerEmails(
        "Elm Bar Inventory - INCOMPLETE (" + date + " " + shift + " " + bartender + ") - NOT RECORDED",
        "The submission from " + bartender + " on " + date + " " + shift + " was REJECTED because " + missingLevels.length +
          " items had no stock level selected. Please ask them to re-submit with actual levels (E, 1/8, 1/4, 1/2, etc.) for all bottles.",
        "<p><strong>Submission Rejected</strong></p><p>The submission from <strong>" + escapeHtml(bartender) + "</strong> on " +
          "<strong>" + escapeHtml(date) + " " + escapeHtml(shift) + "</strong> was rejected.</p>" +
          "<p><strong style='color:#d32f2f;'>" + missingLevels.length + " items had no stock level selected:</strong></p>" +
          "<ul>" + missingLevels.map(function(s) { return "<li>" + escapeHtml(s) + "</li>"; }).join("") + "</ul>" +
          "<p>Please ask the bartender to re-submit with actual stock levels (E, 1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 7/8, or Full) for all bottles.</p>"
      );
      return;
    }

    var col = lastCol + 1;
    ensureCapacity(sheet, spirits.length + 4, col);

    sheet.getRange(1, col)
         .setValue(straightLine ? (headerText + "\n\u26A0 CHECK") : headerText)
         .setFontWeight("bold")
         .setBackground(straightLine ? CONFIG.SHEET_COLORS.flagBg : CONFIG.SHEET_COLORS.colHeaderBg)
         .setFontColor(straightLine ? CONFIG.COLORS.navy : "#FFFFFF")
         .setWrap(true)
         .setFontSize(10)
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle");

    sheet.getRange(2, col, values.length, 1)
         .setValues(values)
         .setBackgrounds(colors)
         .setFontSize(10)
         .setFontWeight("bold")
         .setHorizontalAlignment("center")
         .setVerticalAlignment("middle");

    if (notes) {
      sheet.getRange(spirits.length + 3, col)
           .setValue(notes)
           .setFontSize(9)
           .setWrap(true)
           .setVerticalAlignment("top");
    }

    sheet.setColumnWidth(col, 115);

    var url = ss.getUrl();
    var subject = "Elm Bar Inventory - " + date + " " + shift +
      (lowStock.length > 0 ? " (" + lowStock.length + " low)" : "") +
      (missingSpirits.length > 0 ? " \u26A0 " + missingSpirits.length + " missing" : "") +
      (missingLevels.length > 0 ? " \u26A0\uFE0F " + missingLevels.length + " incomplete" : "") +
      (invalidUnopened.length > 0 ? " \u26A0 " + invalidUnopened.length + " typed answers" : "") +
      (straightLine ? " \u26A0 LOOKS STRAIGHT-LINED" : "");

    sendManagerEmails(
      subject,
      buildPlainText(date, shift, bartender, lowStock, notes, url, missingSpirits, missingLevels, invalidUnopened),
      buildEmailHtml(date, shift, bartender, lowStock, notes, url, missingSpirits, missingLevels, invalidUnopened)
    );

    if (straightLine) {
      sheet.getRange(1, col).setNote(
        straightLine.count + " of " + straightLine.total + ' bottles were all recorded as "' +
        straightLine.value + '". That is ' + Math.round(straightLine.share * 100) +
        '% identical - check with ' + bartender + ' before trusting this column.');
    }

    Logger.log("Recorded " + headerText.replace("\n", " ") + " in " + sheet.getName() +
      " | low stock: " + lowStock.length + " | missing levels: " + missingLevels.length);

    try {
      refreshDashboardIfDue(ss);
    } catch (dashErr) {
      Logger.log("Dashboard refresh failed (submission and email are intact): " + dashErr);
    }

  } catch (err) {
    Logger.log("Submit error: " + err);
    Logger.log(err.stack);
  } finally {
    lock.releaseLock();
  }
}

function refreshDashboardIfDue(ss) {
  var props = PropertiesService.getScriptProperties();
  var lastRun = parseInt(props.getProperty("lastDashboardRefreshMs") || "0", 10);
  var now = Date.now();
  var intervalMs = CONFIG.DASHBOARD_MIN_REFRESH_INTERVAL_MINUTES * 60 * 1000;

  if (now - lastRun < intervalMs) {
    Logger.log("Dashboard refresh skipped (throttled - last ran " +
      Math.round((now - lastRun) / 60000) + " min ago, interval is " +
      CONFIG.DASHBOARD_MIN_REFRESH_INTERVAL_MINUTES + " min).");
    return;
  }

  refreshDashboard(ss);
  props.setProperty("lastDashboardRefreshMs", String(now));
}

// Creates the Manager Dashboard sheet if needed and keeps it as the
// first tab. Called from onFormSubmit, setupDashboardNow, and
// refreshDashboard.
function ensureDashboard(ss) {
  var sheet = ss.getSheetByName(CONFIG.DASHBOARD_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.DASHBOARD_NAME, 0);
  } else if (ss.getSheets().indexOf(sheet) !== 0) {
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(1);
  }
  return sheet;
}

function refreshDashboard(ss) {
  var sheet = ensureDashboard(ss);
  var spirits = getAllSpirits();

  var savedSearch = "";
  var savedRef = PropertiesService.getScriptProperties().getProperty("searchCellA1");
  if (savedRef) {
    try {
      var prior = sheet.getRange(savedRef).getValue();
      if (prior) savedSearch = String(prior);
    } catch (e) {
      savedSearch = "";
    }
  }

  ensureCapacity(sheet, 400, CONFIG.HELPER_START_COL + CONFIG.HELPER_COL_COUNT);

  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  sheet.clearConditionalFormatRules();

  var data = collectHistory(ss);
  var records = data.records;
  var bySpirit = data.bySpirit;
  var weekSheets = data.weekSheets;
  var currentPars = readCurrentPars(ss);

  var recentWeeks = {};
  var analysisSlice = weekSheets.slice(0, CONFIG.ANALYSIS_WEEKS);
  for (var a = 0; a < analysisSlice.length; a++) recentWeeks[analysisSlice[a].getName()] = true;

  var navy = CONFIG.SHEET_COLORS.headerBg;
  var sand = CONFIG.COLORS.sand;
  var muted = CONFIG.COLORS.muted;
  var row = 1;

  sheet.getRange(row, 1, 1, 5).merge()
       .setValue("THE ELM BAR   —   MANAGER DASHBOARD")
       .setFontSize(16).setFontWeight("bold").setFontColor("#FFFFFF")
       .setBackground(navy).setVerticalAlignment("middle");
  sheet.setRowHeight(row, 38);
  row++;

  sheet.getRange(row, 1, 1, 5).merge()
       .setValue("Updated " + new Date().toLocaleString() +
                 "     •     " + weekSheets.length + " week(s) on file" +
                 "     •     " + records.length + " readings")
       .setFontStyle("italic").setFontColor(muted).setFontSize(10);
  row += 2;

  var currentWeekName = getWeekRange(new Date()).name;
  var shiftsSeen = {};
  var currentLow = {};

  for (var i = 0; i < records.length; i++) {
    if (records[i].week !== currentWeekName) continue;
    shiftsSeen[records[i].header] = true;
    if (CONFIG.LOW_STOCK_LEVELS.indexOf(records[i].level) !== -1) {
      currentLow[records[i].spirit] = records[i].level;
    }
  }

  sheet.getRange(row, 1).setValue("THIS WEEK   (" + currentWeekName + ")")
       .setFontWeight("bold").setFontSize(12).setFontColor(navy);
  row++;

  sheet.getRange(row, 1, 2, 2).setValues([
    ["Shifts recorded", Object.keys(shiftsSeen).length],
    ["Bottles currently low", Object.keys(currentLow).length]
  ]);
  sheet.getRange(row, 1, 2, 1).setFontWeight("bold").setBackground(sand);
  row += 3;

  sheet.getRange(row, 1).setValue("CHRONIC LOW STOCK   (last " + CONFIG.ANALYSIS_WEEKS + " weeks)")
       .setFontWeight("bold").setFontSize(12).setFontColor("#8a4a38");
  row++;
  sheet.getRange(row, 1, 1, 4)
       .setValues([["Bottle", "Times Low", "Last Seen", "Action"]])
       .setFontWeight("bold").setBackground(sand);
  row++;

  var chronic = [];
  for (var cs = 0; cs < spirits.length; cs++) {
    var cname = spirits[cs];
    var clist = bySpirit[cname];
    var hits = [];
    for (var q = 0; q < clist.length; q++) {
      if (recentWeeks[clist[q].week] && CONFIG.LOW_STOCK_LEVELS.indexOf(clist[q].level) !== -1) {
        hits.push(clist[q]);
      }
    }
    if (hits.length >= CONFIG.CHRONIC_THRESHOLD) {
      hits.sort(function (x, y) { return y.seq - x.seq; });
      chronic.push([cname, hits.length, hits[0].header, "Raise par level or reorder sooner"]);
    }
  }
  chronic.sort(function (x, y) { return y[1] - x[1]; });

  if (chronic.length === 0) {
    sheet.getRange(row, 1).setValue("None — nothing ran low repeatedly.")
         .setFontStyle("italic").setFontColor(muted);
    row++;
  } else {
    sheet.getRange(row, 1, chronic.length, 4).setValues(chronic)
         .setBackground(CONFIG.SHEET_COLORS.chronicBg);
    row += chronic.length;
  }
  row += 2;

  sheet.getRange(row, 1).setValue("PAR LEVELS   (current vs suggested, last " + CONFIG.ANALYSIS_WEEKS + " weeks)")
       .setFontWeight("bold").setFontSize(12).setFontColor("#3d5566");
  row++;
  sheet.getRange(row, 1, 1, 5)
       .setValues([["Bottle", "Current Par", "Suggested", "Avg Fill", "Flag"]])
       .setFontWeight("bold").setBackground(sand);
  row++;

  var parRows = [];
  var flagRows = [];

  for (var ps = 0; ps < spirits.length; ps++) {
    var pname = spirits[ps];
    var plist = bySpirit[pname];
    var used = [];
    for (var pi = 0; pi < plist.length; pi++) {
      if (recentWeeks[plist[pi].week]) used.push(plist[pi]);
    }
    if (used.length === 0) continue;

    var fillSum = 0, backupSum = 0;
    for (var u = 0; u < used.length; u++) {
      var frac = LEVEL_TO_FRACTION[used[u].level];
      fillSum += (frac === undefined ? 0 : frac);
      backupSum += (parseFloat(used[u].unopened) || 0);
    }

    var avgFill = fillSum / used.length;
    var avgBackup = backupSum / used.length;
    var suggested = Math.max(1, Math.round(avgBackup + (1 - avgFill) + 0.5));

    var currentPar = currentPars[pname];
    var currentNum = parseFloat(currentPar);
    var flag = "";

    if (currentPar === undefined || currentPar === "") {
      flag = "Not set";
    } else if (!isNaN(currentNum)) {
      if (currentNum < suggested) flag = "Under by " + (suggested - currentNum);
      else if (currentNum > suggested + 1) flag = "Over by " + (currentNum - suggested);
    }

    parRows.push([
      pname,
      currentPar === undefined ? "" : currentPar,
      suggested,
      Math.round(avgFill * 100) + "%",
      flag
    ]);
    flagRows.push(flag !== "");
  }

  if (parRows.length === 0) {
    sheet.getRange(row, 1).setValue("Not enough data yet.")
         .setFontStyle("italic").setFontColor(muted);
    row++;
  } else {
    sheet.getRange(row, 1, parRows.length, 5).setValues(parRows);
    for (var fr = 0; fr < flagRows.length; fr++) {
      if (flagRows[fr]) {
        sheet.getRange(row + fr, 5).setBackground(CONFIG.SHEET_COLORS.flagBg).setFontWeight("bold");
      }
    }
    row += parRows.length;
  }
  row += 2;

  sheet.getRange(row, 1).setValue("FILL TREND   (last " + CONFIG.TREND_WEEKS + " weeks, left = oldest)")
       .setFontWeight("bold").setFontSize(12).setFontColor(navy);
  row++;
  sheet.getRange(row, 1, 1, 3)
       .setValues([["Bottle", "Trend", "Latest Reading"]])
       .setFontWeight("bold").setBackground(sand);
  row++;

  var trendWeekNames = weekSheets.slice(0, CONFIG.TREND_WEEKS)
    .map(function (s) { return s.getName(); })
    .reverse();

  var trendNames = [];
  var trendFormulas = [];
  var trendLatest = [];

  for (var ts = 0; ts < spirits.length; ts++) {
    var tname = spirits[ts];
    var tlist = bySpirit[tname];
    if (tlist.length === 0) continue;

    var points = [];
    for (var tw = 0; tw < trendWeekNames.length; tw++) {
      var sum = 0, count = 0;
      for (var tr = 0; tr < tlist.length; tr++) {
        if (tlist[tr].week !== trendWeekNames[tw]) continue;
        var f = LEVEL_TO_FRACTION[tlist[tr].level];
        sum += (f === undefined ? 0 : f);
        count++;
      }
      if (count > 0) points.push(Math.round((sum / count) * 1000) / 1000);
    }
    if (points.length === 0) continue;

    var newest = tlist[0];
    for (var n = 1; n < tlist.length; n++) {
      if (tlist[n].seq > newest.seq) newest = tlist[n];
    }

    trendNames.push([tname]);
    trendFormulas.push([
      '=SPARKLINE({' + points.join(",") + '},{"charttype","column";"color","' +
      CONFIG.COLORS.terracotta + '";"ymin",0;"ymax",1})'
    ]);
    trendLatest.push([describeLevel(newest.level) + "  (" + newest.header + ")"]);
  }

  if (trendNames.length > 0) {
    sheet.getRange(row, 1, trendNames.length, 1).setValues(trendNames);
    sheet.getRange(row, 2, trendFormulas.length, 1).setFormulas(trendFormulas);
    sheet.getRange(row, 3, trendLatest.length, 1).setValues(trendLatest)
         .setFontColor(muted).setFontSize(10);
    row += trendNames.length;
  } else {
    sheet.getRange(row, 1).setValue("Not enough data yet.")
         .setFontStyle("italic").setFontColor(muted);
    row++;
  }
  row += 2;

  sheet.getRange(row, 1).setValue("SEARCH A BOTTLE")
       .setFontWeight("bold").setFontSize(12).setFontColor(navy);
  row++;

  sheet.getRange(row, 1).setValue("Pick a bottle:").setFontWeight("bold");

  var searchCell = sheet.getRange(row, 2);
  searchCell.setBackground(CONFIG.SHEET_COLORS.searchBg)
            .setFontWeight("bold")
            .setDataValidation(
              SpreadsheetApp.newDataValidation()
                .requireValueInList(spirits, true)
                .setAllowInvalid(false)
                .build()
            );
  if (savedSearch) searchCell.setValue(savedSearch);

  PropertiesService.getScriptProperties()
    .setProperty("searchCellA1", searchCell.getA1Notation());

  var searchRow = row;
  row++;

  sheet.getRange(row, 1, 1, 3)
       .setValues([["Week", "Shift", "Level - Backup"]])
       .setFontWeight("bold").setBackground(sand);
  row++;

  var helper = [];
  for (var hr = 0; hr < records.length; hr++) {
    helper.push([
      records[hr].spirit,
      records[hr].week,
      records[hr].header,
      records[hr].level + " - " + records[hr].unopened,
      records[hr].seq
    ]);
  }

  var hCol = CONFIG.HELPER_START_COL;

  if (helper.length > 0) {
    ensureCapacity(sheet, helper.length + 10, hCol + CONFIG.HELPER_COL_COUNT);
    sheet.getRange(1, hCol, helper.length, CONFIG.HELPER_COL_COUNT).setValues(helper);

    var c1 = columnToLetter(hCol);
    var c2 = columnToLetter(hCol + 1);
    var c3 = columnToLetter(hCol + 2);
    var c4 = columnToLetter(hCol + 3);
    var c5 = columnToLetter(hCol + 4);

    var formula =
      '=IFERROR(QUERY(' + c1 + '1:' + c5 + helper.length +
      ',"select ' + c2 + ',' + c3 + ',' + c4 +
      ' where ' + c1 + ' = "&CHAR(34)&B' + searchRow + '&CHAR(34)&"' +
      ' order by ' + c5 + ' desc",0),"Pick a bottle above to see its history")';

    sheet.getRange(row, 1).setFormula(formula);
  } else {
    sheet.getRange(row, 1).setValue("No history recorded yet.")
         .setFontStyle("italic").setFontColor(muted);
  }

  sheet.hideColumns(hCol, CONFIG.HELPER_COL_COUNT);

  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 130);
  sheet.setColumnWidth(3, 130);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 130);
  sheet.setFrozenRows(2);
}

function collectHistory(ss) {
  var spirits = getAllSpirits();
  var isSpirit = {};
  for (var i = 0; i < spirits.length; i++) isSpirit[spirits[i]] = true;

  var weekSheets = getAllWeekSheets(ss).slice(0, CONFIG.MAX_HISTORY_WEEKS);
  var records = [];

  for (var w = 0; w < weekSheets.length; w++) {
    var sheet = weekSheets[w];
    var lastCol = sheet.getLastColumn();
    var lastRow = sheet.getLastRow();
    if (lastCol < 3 || lastRow < 2) continue;

    var rowCount = Math.min(spirits.length, lastRow - 1);
    var names = sheet.getRange(2, 1, rowCount, 1).getValues();
    var headers = sheet.getRange(1, 3, 1, lastCol - 2).getValues()[0];
    var block = sheet.getRange(2, 3, rowCount, lastCol - 2).getValues();

    var weekName = sheet.getName();
    var weekTs = weekNameToTimestamp(weekName);

    for (var r = 0; r < rowCount; r++) {
      var spirit = names[r][0];
      if (!isSpirit[spirit]) continue;

      for (var c = 0; c < headers.length; c++) {
        var raw = block[r][c];
        if (!raw) continue;

        var parts = String(raw).split(" - ");
        records.push({
          spirit: spirit,
          week: weekName,
          header: String(headers[c]).replace(/\n/g, " "),
          level: (parts[0] || "").trim(),
          unopened: (parts[1] || "0").trim(),
          seq: weekTs + c
        });
      }
    }
  }

  var bySpirit = {};
  for (var s = 0; s < spirits.length; s++) bySpirit[spirits[s]] = [];
  for (var k = 0; k < records.length; k++) bySpirit[records[k].spirit].push(records[k]);

  return { records: records, bySpirit: bySpirit, weekSheets: weekSheets };
}

// ============================================================
// MENU-DRIVEN TEST ENTRY + FORM LINK SHARING  (NEW in v4)
//
// Both of these are reachable from the "Elm Bar" menu at the top of
// the spreadsheet - no need to open the Apps Script editor for either
// one. Useful for managers who aren't comfortable in the script
// editor day-to-day.
// ============================================================

// Runs the same simulated submission used for testing (fake bartender
// "TEST - Diagnostics", every bottle at 1/2, no missing data) but from
// a spreadsheet menu click instead of the script editor's Run button.
// Safe to run any time - it's the same one-off test row you'd delete
// later, not a change to how real submissions are processed.
function sendTestEntryFromMenu() {
  simulateFormSubmit();
  try {
    SpreadsheetApp.getUi().alert(
      "Test entry submitted.\n\n" +
      "Check this week's tab for a new column labeled \"TEST - Diagnostics\" " +
      "and confirm the manager email arrived. Delete that test column whenever " +
      "you're done confirming things work."
    );
  } catch (e) {
    // Running from the script editor instead of the sheet UI - no
    // alert dialog available there, just rely on the Execution log.
  }
}

// Emails the LIVE form link to the managers on file. This is the
// actual link bartenders fill out - not a test, not a copy. Use this
// to re-share it (e.g., after a new hire, or if the bookmark/QR code
// at the bar goes missing) without having to dig up the link
// yourself.
function emailFormLinkToManagers() {
  var form = getForm();
  var url = form.getPublishedUrl();

  var subject = "Elm Bar Inventory - Form Link";
  var plain = "Here is the live Elm Bar Inventory form link:\n\n" + url +
    "\n\nShare this with bartenders as needed - e.g. save it as a phone " +
    "bookmark or print it as a QR code at the bar.";
  var html = "<p>Here is the live <strong>Elm Bar Inventory</strong> form link:</p>" +
    "<p><a href=\"" + url + "\">" + url + "</a></p>" +
    "<p>Share this with bartenders as needed - e.g. save it as a phone bookmark " +
    "or print it as a QR code at the bar.</p>";

  sendManagerEmails(subject, plain, html);

  try {
    SpreadsheetApp.getUi().alert("Form link emailed to managers.");
  } catch (e) {
    // Running from the script editor - no alert dialog, that's fine.
  }
}

// ============================================================
// v6 — ADOPTION PACK
//   1. Nightly rotation: the form only ever asks for tonight's
//      categories (~9 bottles), not all 44.
//   2. Five fill levels instead of nine: no sideways scrolling on a
//      phone, and no false precision to hide behind.
//   4. Straight-line detector: a submission where nearly every bottle
//      reads the same is recorded but flagged, not trusted.
//   + Bartender roster, managed from the Manager Dashboard.
//   + Conditional 9:30pm reminder - only when tonight's count is missing.
//   + Bartender becomes a dropdown fed by the roster, so nobody types
//     their name and "Abhik" never becomes "abhik".
//
// The form is edited IN PLACE throughout. Its URL never changes, so the
// QR code already printed and hung at the bar keeps working.
// ============================================================

const ROSTER_SHEET_NAME = "Bartenders";
const ROSTER_HEADERS = ["Name", "Email", "Phone", "Active", "Added", "Last Count"];

// Which categories get counted on which day. Index 0 = Sunday.
// Fast movers (Well Spirits, Vodka, Whiskey) come round twice a week;
// everything is covered at least once.
const ROTATION = [
  ["Vodka", "Whiskey / Bourbon"],                        // Sun
  ["Well Spirits", "Vodka"],                             // Mon
  ["Whiskey / Bourbon", "Cognac"],                       // Tue
  ["Tequila / Mezcal", "Rum", "Gin"],                    // Wed
  ["Premium Liqueurs"],                                  // Thu
  ["Well Liqueurs / Mixers"],                            // Fri
  ["Well Spirits", "Mixers & Syrups"]                    // Sat
];

// A count whose levels are this uniform is almost certainly not a count.
const OTHER_BARTENDER_LABEL = "Someone else (type in Notes)";
const STRAIGHT_LINE_THRESHOLD = 0.70;
const STRAIGHT_LINE_MIN_ROWS = 6;

const REMINDER_HOUR = 21;    // 9pm block; Apps Script fires within the hour
const REMINDER_MINUTE = 30;

function todaysCategories(d) {
  var day = (d || new Date()).getDay();
  return ROTATION[day] || [];
}

function todaysBottles(d) {
  var cats = todaysCategories(d);
  var out = [];
  for (var i = 0; i < cats.length; i++) {
    var rows = SPIRIT_CATEGORIES[cats[i]];
    if (rows) out = out.concat(rows);
  }
  return out;
}

// ------------------------------------------------------------
// NIGHTLY FORM REBUILD
// The form carries exactly two grids. Every evening this swaps their
// rows to tonight's categories. ~4 API calls, so it cannot time out
// the way the full 44-bottle conversion did.
// ------------------------------------------------------------
const NIGHTLY_LEVEL_TITLE = "Tonight's Bottles - Fill Level";
const NIGHTLY_UNOPENED_TITLE = "Tonight's Bottles - Backups in the Back";

function rebuildNightlyForm() {
  var form = getForm();
  var bottles = todaysBottles();
  if (!bottles.length) {
    Logger.log("No categories scheduled for today - form left as it was.");
    return;
  }
  var cats = todaysCategories().join(" + ");

  var lvl = null, un = null;
  var items = form.getItems(FormApp.ItemType.GRID);
  for (var i = 0; i < items.length; i++) {
    var t = String(items[i].getTitle());
    if (t.indexOf("Fill Level") !== -1) lvl = items[i].asGridItem();
    else if (t.indexOf("Backups") !== -1) un = items[i].asGridItem();
  }
  if (!lvl) lvl = form.addGridItem();
  if (!un) un = form.addGridItem();

  // Clear out v5's twenty per-category grids the first time this runs.
  // Leaving them up would mean a bartender still faces all 44 bottles,
  // which is the whole problem this version exists to fix.
  var stale = 0;
  var all = form.getItems(FormApp.ItemType.GRID);
  for (var d = all.length - 1; d >= 0; d--) {
    var title = String(all[d].getTitle());
    if (all[d].getId() === lvl.getId() || all[d].getId() === un.getId()) continue;
    if (title.indexOf(GRID_LEVEL_PREFIX) === 0 || title.indexOf(GRID_UNOPENED_PREFIX) === 0) {
      form.deleteItem(all[d]);
      stale++;
    }
  }
  if (stale) Logger.log("Removed " + stale + " leftover per-category grids from v5.");

  lvl.setTitle(NIGHTLY_LEVEL_TITLE)
     .setHelpText("Tonight: " + cats + ". Tap how full each open bottle is.")
     .setRows(bottles)
     .setColumns(GRID_LEVEL_COLUMNS)
     .setRequired(true);

  un.setTitle(NIGHTLY_UNOPENED_TITLE)
    .setHelpText("Sealed backups behind each one. Tap 6+ if there are more than five.")
    .setRows(bottles)
    .setColumns(GRID_UNOPENED_COLUMNS)
    .setRequired(true);

  form.setConfirmationMessage(
    "Counted: " + cats + ". Thank you - that is tonight's whole job.\n" +
    "Spotted a mistake? Open the form again and submit a correction; the newest one wins."
  );
  form.setAllowResponseEdits(true);

  Logger.log("Form set for " + cats + " (" + bottles.length + " bottles).");
}

function installNightlyTriggers() {
  var keep = ["rebuildNightlyForm", "sendNightlyReminder"];
  var all = ScriptApp.getProjectTriggers();
  for (var i = 0; i < all.length; i++) {
    if (keep.indexOf(all[i].getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(all[i]);
  }
  ScriptApp.newTrigger("rebuildNightlyForm").timeBased().atHour(16).everyDays(1).create();
  ScriptApp.newTrigger("sendNightlyReminder").timeBased().atHour(REMINDER_HOUR)
    .nearMinute(REMINDER_MINUTE).everyDays(1).create();
  Logger.log("Nightly triggers installed: form rebuild at 4pm, reminder at ~9:30pm.");
}

// ------------------------------------------------------------
// BARTENDER ROSTER
// ------------------------------------------------------------
function getRosterSheet(ss) {
  var sh = ss.getSheetByName(ROSTER_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(ROSTER_SHEET_NAME);
    sh.getRange(1, 1, 1, ROSTER_HEADERS.length).setValues([ROSTER_HEADERS])
      .setFontWeight("bold").setFontColor("#ffffff")
      .setBackground(CONFIG.SHEET_COLORS.headerBg);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(2, 230);
    var note = sh.getRange(1, 4);
    note.setNote('Set Active to "No" when someone leaves. They stop getting the ' +
                 'nightly reminder that night. Nothing else needs changing.');
  }
  return sh;
}

function readRoster(ss) {
  var sh = getRosterSheet(ss);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, ROSTER_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var name = String(vals[i][0]).trim();
    if (!name) continue;
    out.push({
      row: i + 2,
      name: name,
      email: String(vals[i][1]).trim(),
      phone: String(vals[i][2]).trim(),
      active: String(vals[i][3]).trim().toLowerCase() !== "no",
      lastCount: vals[i][5]
    });
  }
  return out;
}

// Called on every submission: adds a bartender the first time they
// appear, and keeps their email and last-count date current.
function rememberBartender(ss, name, email) {
  name = String(name || "").trim();
  if (!name) return;
  var sh = getRosterSheet(ss);
  var roster = readRoster(ss);
  for (var i = 0; i < roster.length; i++) {
    if (roster[i].name.toLowerCase() === name.toLowerCase()) {
      if (email && !roster[i].email) sh.getRange(roster[i].row, 2).setValue(email);
      sh.getRange(roster[i].row, 6).setValue(new Date());
      return;
    }
  }
  sh.appendRow([name, email || "", "", "Yes", new Date(), new Date()]);
  Logger.log("Roster: added " + name + (email ? "" : " (no email yet - add one so reminders reach them)"));
  try {
    syncBartenderDropdown();
  } catch (e) {
    Logger.log("Dropdown sync skipped: " + e);
  }
}

// Keeps the form's Bartender question as a dropdown of everyone active.
// One shared form, one QR, no typing - and the spelling stays stable, so
// a person's history does not split in two.
function syncBartenderDropdown() {
  var ss = getSpreadsheet();
  var roster = readRoster(ss);
  var names = [];
  for (var i = 0; i < roster.length; i++) {
    if (roster[i].active) names.push(roster[i].name);
  }
  if (!names.length) {
    Logger.log("Roster has nobody active - dropdown left alone.");
    return;
  }
  names.sort();
  names.push(OTHER_BARTENDER_LABEL);

  var form = getForm();
  var items = form.getItems();
  for (var j = 0; j < items.length; j++) {
    var t = String(items[j].getTitle()).toLowerCase();
    if (t.indexOf("bartender") !== 0) continue;
    var type = items[j].getType();
    if (type === FormApp.ItemType.LIST) {
      items[j].asListItem().setChoiceValues(names);
      Logger.log("Bartender dropdown updated: " + names.join(", "));
      return;
    }
    if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
      items[j].asMultipleChoiceItem().setChoiceValues(names);
      Logger.log("Bartender choices updated: " + names.join(", "));
      return;
    }
    Logger.log('Bartender question is still free text. Change it to a ' +
               'Dropdown in the form once, then re-run this.');
    return;
  }
  Logger.log("No Bartender question found on the form.");
}

// ------------------------------------------------------------
// CONDITIONAL NIGHTLY REMINDER
// Nothing is sent if tonight's count already landed. A reminder that
// only arrives when it is actually needed keeps getting read.
// ------------------------------------------------------------
function countExistsForToday(ss) {
  var name = getWeekRange(new Date()).name;
  var sheet = ss.getSheetByName(name);
  if (!sheet) return false;
  var lastCol = sheet.getLastColumn();
  if (lastCol < 3) return false;
  var headers = sheet.getRange(1, 3, 1, lastCol - 2).getValues()[0];
  var today = formatDateShort(new Date());
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).indexOf(today) === 0) return true;
  }
  return false;
}

function sendNightlyReminder() {
  var ss = getSpreadsheet();
  if (countExistsForToday(ss)) {
    Logger.log("Tonight's count is already in - no reminder sent.");
    return;
  }
  var roster = readRoster(ss);
  var cats = todaysCategories().join(" + ");
  var bottles = todaysBottles().length;
  var formUrl = getForm().getPublishedUrl();   // the same link the printed QR points at
  var sent = 0;

  for (var i = 0; i < roster.length; i++) {
    var b = roster[i];
    if (!b.active || !b.email) continue;
    var link = formUrl;
    var subject = "Bar count tonight - " + cats + " (" + bottles + " bottles)";
    var plain = "Hi " + b.name + ",\n\nTonight's bar count has not come in yet.\n\n" +
      "Tonight is " + cats + " - " + bottles + " bottles, about two minutes.\n\n" +
      link + "\n\nIf someone else already counted, ignore this.\n";
    var html =
      '<div style="font-family:Helvetica,Arial,sans-serif;color:' + CONFIG.COLORS.navy + ';">' +
      '<p>Hi ' + escapeHtml(b.name) + ',</p>' +
      '<p>Tonight’s bar count has not come in yet.</p>' +
      '<p style="font-size:16px;"><strong>Tonight: ' + escapeHtml(cats) + '</strong><br>' +
      bottles + ' bottles — about two minutes.</p>' +
      '<p><a href="' + link + '" style="background:' + CONFIG.COLORS.terracotta +
      ';color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none;' +
      'display:inline-block;font-size:16px;">Count tonight’s bottles</a></p>' +
      '<p style="color:' + CONFIG.COLORS.muted + ';font-size:13px;">' +
      'If someone else already counted, ignore this.</p></div>';
    try {
      MailApp.sendEmail({ to: b.email, subject: subject, body: plain, htmlBody: html });
      sent++;
    } catch (err) {
      Logger.log("Reminder to " + b.email + " failed: " + err);
    }
  }
  Logger.log("Reminders sent: " + sent + " (managers were not emailed).");
}

// ------------------------------------------------------------
// STRAIGHT-LINE DETECTION
// 09/18 came in with all 44 bottles at 1/2 and the word "Same" typed
// in every backup field. It still counts as a submission - but it
// should never be mistaken for a count.
// ------------------------------------------------------------
function detectStraightLine(levels) {
  var vals = [];
  for (var i = 0; i < levels.length; i++) {
    if (levels[i]) vals.push(levels[i]);
  }
  if (vals.length < STRAIGHT_LINE_MIN_ROWS) return null;
  var tally = {};
  for (var j = 0; j < vals.length; j++) tally[vals[j]] = (tally[vals[j]] || 0) + 1;
  var topVal = null, topCount = 0;
  for (var k in tally) {
    if (tally[k] > topCount) { topCount = tally[k]; topVal = k; }
  }
  var share = topCount / vals.length;
  if (share < STRAIGHT_LINE_THRESHOLD) return null;
  return { value: topVal, count: topCount, total: vals.length, share: share };
}
