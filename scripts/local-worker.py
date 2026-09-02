#!/usr/bin/env python3
"""
Pipeline worker for the Mac.

The app's server can't run a browser, so when a run needs a page scraped it
parks at the Stage 1 gate and lists the page in /api/worker/queue. This script
polls that queue every 20s, scrapes each page here (residential IP, real
browser when needed) with supplier-scrape.py, and pushes the result back
through /api/runs/<id>/scrape-push — after which the app writes the product
description and the run shows up as "ready for your review".

Usage:
    scrapling-py ~/Desktop/pipeline-worker.py            # run forever (what launchd does)
    scrapling-py ~/Desktop/pipeline-worker.py --once     # one pass, then exit

Password: read from the macOS Keychain (never from a file or the command line).
Add it once with:
    security add-generic-password -s pipeline-app -a worker -w
(it prompts for the password; nothing lands in shell history).

App URL: PIPELINE_APP_URL env var, default https://pipeline-app-6icd.onrender.com
"""
import json
import os
import sys
import time
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

APP_URL = os.environ.get("PIPELINE_APP_URL", "https://pipeline-app-6icd.onrender.com").rstrip("/")
POLL_SECONDS = 20
STATE_FILE = Path.home() / "Desktop" / "scraped" / ".worker-state.json"
RETRY_AFTER = 30 * 60      # a failed URL is retried after 30 min
MAX_ATTEMPTS = 6           # then left alone (the gate still offers the manual command)


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def keychain_password() -> str:
    if os.environ.get("PIPELINE_APP_PASSWORD"):
        return os.environ["PIPELINE_APP_PASSWORD"]
    r = subprocess.run(["security", "find-generic-password", "-s", "pipeline-app", "-a", "worker", "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("No password in the Keychain. Add it once with:\n"
                 "  security add-generic-password -s pipeline-app -a worker -w")
    return r.stdout.strip()


class App:
    def __init__(self) -> None:
        self.cookie = ""

    def login(self) -> None:
        req = urllib.request.Request(f"{APP_URL}/api/auth/login", method="POST",
                                     data=json.dumps({"password": keychain_password()}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            self.cookie = r.headers.get("Set-Cookie", "").split(";")[0]
        if not self.cookie:
            raise RuntimeError("login returned no session cookie")

    def get(self, path: str) -> dict:
        if not self.cookie:
            self.login()
        req = urllib.request.Request(f"{APP_URL}{path}", headers={"Cookie": self.cookie})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 401:
                self.cookie = ""
                self.login()
                return self.get(path)
            raise


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def due(state: dict, key: str) -> bool:
    e = state.get(key)
    if not e:
        return True
    if e.get("attempts", 0) >= MAX_ATTEMPTS:
        return False
    return time.time() - e.get("at", 0) >= RETRY_AFTER


def run_once(app: App, scraper) -> int:
    data = app.get("/api/worker/queue")
    jobs = data.get("jobs", [])
    state = load_state()
    done = 0
    for job in jobs:
        run_id = job["runId"]
        # competitors first, product last — the final push triggers the analyst
        urls = sorted(job["urls"], key=lambda u: 0 if u["role"] == "competitor" else 1)
        pending = [u for u in urls if due(state, f"{run_id}:{u['url']}")]
        if not pending:
            continue
        for i, u in enumerate(pending):
            key = f"{run_id}:{u['url']}"
            last = i == len(pending) - 1
            log(f"run #{run_id}: scraping {u['role']} page {u['url'][:70]}")
            try:
                folder = scraper.scrape(u["url"], refresh=False)
                scraper.push_to_app(APP_URL, str(run_id), folder, describe=last)
                state.pop(key, None)
                done += 1
                log(f"run #{run_id}: pushed{' + description requested' if last else ''}")
            except SystemExit as e:      # the scraper reports hard failures via sys.exit
                msg = str(e).strip()
                log(f"run #{run_id}: failed — {msg[:160]}")
                st = state.get(key, {"attempts": 0})
                state[key] = {"attempts": st["attempts"] + 1, "at": time.time(), "error": msg[:300]}
            except Exception as e:
                log(f"run #{run_id}: failed — {e}")
                st = state.get(key, {"attempts": 0})
                state[key] = {"attempts": st["attempts"] + 1, "at": time.time(), "error": str(e)[:300]}
            save_state(state)
    return done


def main() -> None:
    once = "--once" in sys.argv
    # The scraper file has a hyphen in its name; load it by path.
    spec = importlib.util.spec_from_file_location("supplier_scrape", Path(__file__).resolve().parent / "supplier-scrape.py")
    scraper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scraper)
    scraper.JSON_MODE = True    # keep the scraper's chatter off stdout formatting; we log ourselves

    app = App()
    app.login()
    log(f"worker up — polling {APP_URL} every {POLL_SECONDS}s")
    while True:
        try:
            n = run_once(app, scraper)
            if n:
                log(f"{n} page(s) pushed")
        except Exception as e:
            log(f"poll failed — {e}")
        if once:
            return
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
