#!/usr/bin/env python3
"""vidar_taskbot.py — the local bot that runs the Vidar work list (ops/tasks.toml).

Each run:
  * works out which tasks are due today (daily, weekly, twice-weekly, monthly, once)
  * runs the due ones that have a command, skips ones for another platform,
    marks ones with missing .env keys as "blocked"
  * lists open checklist items (manual tasks a person must do)
  * appends every result to ops/logs/taskbot.jsonl and writes ops/logs/latest.md

State (what already ran, which one-time items are done) is in ops/state.json.

Usage:
  vidar_taskbot.py                 run what's due now
  vidar_taskbot.py --list          show the list and when each runs next
  vidar_taskbot.py --run ID        run one task now
  vidar_taskbot.py --done ID       tick off a manual / one-time item
  vidar_taskbot.py --dry-run       show what would run
Schedule it yourself once the server exists (e.g. Task Scheduler daily 05:00).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import string
import subprocess
import sys
import tomllib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
LIST = HERE / "tasks.toml"
STATE = HERE / "state.json"
LOGDIR = HERE / "logs"
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def load_env() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def load_tasks() -> list[dict]:
    tasks = tomllib.loads(LIST.read_text())["task"]
    ids = [t["id"] for t in tasks]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"duplicate task ids: {', '.join(sorted(dupes))}")
    return tasks


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"last_run": {}, "done": []}


def this_platform() -> str:
    return "windows" if platform.system() == "Windows" else "linux"


def is_due(task: dict, state: dict, today: dt.date) -> bool:
    every = task.get("every", "manual")
    last = state["last_run"].get(task["id"])
    last_date = dt.date.fromisoformat(last[:10]) if last else None
    if task["id"] in state["done"]:
        return False
    if every == "daily":
        return last_date != today
    if every == "once":
        return last_date is None or state["last_run"].get(task["id"] + ":status") != "ok"
    kind, _, arg = every.partition(":")
    if kind in ("weekly", "twice-weekly"):
        days = [DAYS.index(d.strip()) for d in arg.split(",")]
        return today.weekday() in days and last_date != today
    if kind == "monthly":
        return today.day == int(arg) and last_date != today
    return False


def missing_env(task: dict) -> list[str]:
    return [k for k in task.get("needs", []) if not os.environ.get(k)]


def run_task(task: dict, dry: bool) -> dict:
    rec = {"ts": dt.datetime.now().isoformat(timespec="seconds"), "id": task["id"], "title": task["title"]}
    want = task.get("platform", "any")
    if want != "any" and want != this_platform():
        return {**rec, "status": "skipped", "detail": f"{want} only"}
    if miss := missing_env(task):
        return {**rec, "status": "blocked", "detail": "set in .env: " + ", ".join(miss)}
    if task.get("manual") or not task.get("run"):
        return {**rec, "status": "todo", "detail": "needs a person — tick off with --done " + task["id"]}
    cmd = string.Template(task["run"]).safe_substitute(os.environ)
    cmd = cmd.replace("python ", f'"{sys.executable}" ', 1) if cmd.startswith("python ") else cmd
    if dry:
        return {**rec, "status": "dry-run", "detail": cmd}
    try:
        r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True,
                           timeout=task.get("timeout", 600))
        out = (r.stdout + r.stderr).strip()
        return {**rec, "status": "ok" if r.returncode == 0 else "failed", "exit": r.returncode,
                "detail": out[-1500:]}
    except subprocess.TimeoutExpired:
        return {**rec, "status": "failed", "detail": "timed out"}


def write_log(results: list[dict], tasks: list[dict], state: dict) -> Path:
    LOGDIR.mkdir(exist_ok=True)
    with (LOGDIR / "taskbot.jsonl").open("a") as fh:
        for r in results:
            fh.write(json.dumps(r) + "\n")
    icon = {"ok": "✅", "failed": "❌", "blocked": "⛔", "todo": "☐", "skipped": "–", "dry-run": "·"}
    lines = [f"# Vidar taskbot — {dt.datetime.now():%Y-%m-%d %H:%M}", "",
             "| | Task | Status | Detail |", "|---|---|---|---|"]
    for r in results:
        detail = r.get("detail", "").splitlines()[-1:] or [""]
        lines.append(f"| {icon.get(r['status'], '?')} | {r['title']} | {r['status']} | {detail[0][:120]} |")
    open_items = [t for t in tasks if t.get("every") == "once" and t["id"] not in state["done"]
                  and state["last_run"].get(t["id"] + ":status") != "ok"]
    if open_items:
        lines += ["", "## Open setup checklist", *[f"- [ ] {t['title']} (`{t['id']}`)" for t in open_items]]
    out = LOGDIR / "latest.md"
    out.write_text("\n".join(lines) + "\n")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--run", metavar="ID")
    ap.add_argument("--done", metavar="ID")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--date", help="pretend today is YYYY-MM-DD (testing)")
    a = ap.parse_args()

    load_env()
    tasks, state = load_tasks(), load_state()
    today = dt.date.fromisoformat(a.date) if a.date else dt.date.today()
    by_id = {t["id"]: t for t in tasks}

    if a.done:
        if a.done not in by_id:
            print(f"unknown task {a.done}", file=sys.stderr)
            return 1
        state["done"] = sorted(set(state["done"]) | {a.done})
        STATE.write_text(json.dumps(state, indent=2))
        print(f"ticked off: {by_id[a.done]['title']}")
        return 0

    if a.list:
        for t in tasks:
            mark = "done" if t["id"] in state["done"] else ("due" if is_due(t, state, today) else "")
            print(f"{t['id']:<22} {t.get('every', 'manual'):<22} {mark:<5} {t['title']}")
        return 0

    chosen = [by_id[a.run]] if a.run else [t for t in tasks if is_due(t, state, today)]
    if a.run and a.run not in by_id:
        print(f"unknown task {a.run}", file=sys.stderr)
        return 1
    results = [run_task(t, a.dry_run) for t in chosen]
    if not a.dry_run:
        for r in results:
            if r["status"] in ("ok", "failed"):
                state["last_run"][r["id"]] = r["ts"]
                state["last_run"][r["id"] + ":status"] = r["status"]
        STATE.write_text(json.dumps(state, indent=2))
    report = write_log(results, tasks, state) if not a.dry_run else None
    for r in results:
        print(f"[{r['status']:>8}] {r['id']}: {r.get('detail', '').splitlines()[-1] if r.get('detail') else ''}")
    if report:
        print(f"report: {report}")
    return sum(r["status"] == "failed" for r in results)


if __name__ == "__main__":
    sys.exit(main())
