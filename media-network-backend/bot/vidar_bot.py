#!/usr/bin/env python3
"""Vidar Assistant — Telegram bot backed by a local Ollama model.

Answers questions about the fleet in Spanish or English, runs read-only tools
on its own, and asks for a ✅ tap before anything that changes a TV.

Env (.env in the project root is loaded automatically):
  TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS, OLLAMA_URL, OLLAMA_MODEL
Commands: /status  /summary  /help   — or just ask in plain language.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bot"))
from fleet_tools import READ_TOOLS, WRITE_TOOLS, TOOL_SPECS, run_tool  # noqa: E402


def load_env(path: Path) -> None:
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env(ROOT / ".env")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:3b")
ALLOWED = {int(x) for x in os.environ.get("TELEGRAM_ALLOWED_IDS", "").replace(" ", "").split(",") if x}
SYSTEM = (
    "You are Vidar Assistant, managing a private network of 7 Android TV boxes across 5 locations "
    "(apartment, home, partner, office, second-home) served by one home server running Jellyfin. "
    "Reply in the user's language (Spanish or English), briefly and plainly. Use tools to get facts; "
    "never invent device status. For restarts or maintenance, call the tool: the user will be asked to confirm."
)
log = logging.getLogger("vidar-bot")


def ollama_chat(messages: list[dict]) -> dict:
    body = json.dumps({"model": MODEL, "messages": messages, "tools": TOOL_SPECS, "stream": False}).encode()
    req = urllib.request.Request(f"{OLLAMA_URL}/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["message"]


def think(user_text: str) -> tuple[str, list[tuple[str, dict]]]:
    """Run the model with tools. Returns (reply, pending write actions needing confirmation)."""
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user_text}]
    pending: list[tuple[str, dict]] = []
    for _ in range(4):
        msg = ollama_chat(messages)
        calls = msg.get("tool_calls") or []
        if not calls:
            return msg.get("content", "").strip() or "…", pending
        messages.append(msg)
        for c in calls:
            name = c["function"]["name"]
            args = c["function"].get("arguments") or {}
            if isinstance(args, str):
                args = json.loads(args or "{}")
            if name in WRITE_TOOLS:
                pending.append((name, args))
                result = {"status": "awaiting user confirmation"}
            elif name in READ_TOOLS:
                result = run_tool(name, args)
            else:
                result = {"error": f"unknown tool {name}"}
            messages.append({"role": "tool", "content": json.dumps(result)[:6000]})
    return "I couldn't finish that. Try asking more specifically.", pending


def main() -> None:
    from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
    from telegram.ext import Application, CallbackQueryHandler, CommandHandler, ContextTypes, MessageHandler, filters

    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token or not ALLOWED:
        sys.exit("Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_IDS in .env")

    def allowed(update: Update) -> bool:
        return bool(update.effective_user and update.effective_user.id in ALLOWED)

    async def reply_with_actions(update: Update, ctx: ContextTypes.DEFAULT_TYPE, text: str, pending):
        markup = None
        if pending:
            ctx.user_data["pending"] = pending
            rows = [[InlineKeyboardButton(f"✅ {n} {a.get('device_id', 'all')}", callback_data=f"ok:{i}")]
                    for i, (n, a) in enumerate(pending)]
            rows.append([InlineKeyboardButton("✖ Cancel", callback_data="cancel")])
            markup = InlineKeyboardMarkup(rows)
        await update.effective_message.reply_text(text[:4000], reply_markup=markup)

    async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        if not allowed(update):
            return
        await update.effective_chat.send_action("typing")
        try:
            text, pending = think(update.effective_message.text)
        except Exception as e:  # Ollama down, etc.
            text, pending = f"Ollama isn't answering ({e}). Is it running on {OLLAMA_URL}?", []
        await reply_with_actions(update, ctx, text, pending)

    async def on_button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        q = update.callback_query
        await q.answer()
        if not allowed(update):
            return
        pending = ctx.user_data.pop("pending", [])
        if q.data == "cancel" or not pending:
            await q.edit_message_reply_markup(None)
            await q.message.reply_text("Cancelled.")
            return
        name, args = pending[int(q.data.split(":")[1])]
        result = run_tool(name, args)
        await q.edit_message_reply_markup(None)
        await q.message.reply_text(f"{name}: {json.dumps(result)[:3500]}")

    async def status(update: Update, ctx):
        if allowed(update):
            await update.effective_message.reply_text(run_tool("fleet_status", {})["summary"])

    async def summary(update: Update, ctx):
        if allowed(update):
            text, _ = think("Give me today's summary: fleet status, server disk, anything broken.")
            await update.effective_message.reply_text(text)

    async def help_cmd(update: Update, ctx):
        if allowed(update):
            await update.effective_message.reply_text(__doc__)

    app = Application.builder().token(token).build()
    app.add_handler(CommandHandler("status", status))
    app.add_handler(CommandHandler("summary", summary))
    app.add_handler(CommandHandler(["help", "start"], help_cmd))
    app.add_handler(CallbackQueryHandler(on_button))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))

    async def daily(ctx):
        text, _ = think("Daily 9 AM report: fleet status, disk, anything broken. Keep it short.")
        for uid in ALLOWED:
            await ctx.bot.send_message(uid, "🌅 " + text)

    async def weekly(ctx):
        text, _ = think("Weekly report: which TVs had problems this week (use diagnose on any that "
                        "were offline), disk usage, and one suggestion. Keep it short.")
        for uid in ALLOWED:
            await ctx.bot.send_message(uid, "📊 " + text)

    if app.job_queue:
        import datetime as dt
        app.job_queue.run_daily(daily, time=dt.time(9, 0))
        app.job_queue.run_daily(weekly, time=dt.time(10, 0), days=(0,))  # Sunday
    logging.basicConfig(level=logging.INFO)
    app.run_polling()


if __name__ == "__main__":
    main()
