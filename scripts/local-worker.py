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
# Fail fast: the operator would rather scrape it by hand than have the worker
# grind for hours. A page gets a couple of quick retries over ~3 minutes and is
# then left alone, with the manual command already on the run page.
# Back-off between attempts on the same URL. AliExpress throttles an IP for an
# hour or more, so the gaps grow: 2 min, 10 min, 30 min, then hourly — about
# four hours in total before the worker stops trying on its own. The gate's
# "Try again" resets the count.
RETRY_SCHEDULE = [120, 600, 1800, 3600, 3600, 3600]
MAX_ATTEMPTS = len(RETRY_SCHEDULE)


def retry_after(attempts: int) -> int:
    return RETRY_SCHEDULE[min(max(attempts, 1), len(RETRY_SCHEDULE)) - 1]


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
        self.password = ""

    def login(self) -> None:
        self.password = keychain_password()
        req = urllib.request.Request(f"{APP_URL}/api/auth/login", method="POST",
                                     data=json.dumps({"password": self.password}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            self.cookie = r.headers.get("Set-Cookie", "").split(";")[0]
        if not self.cookie:
            raise RuntimeError("login returned no session cookie")

    def post(self, path: str) -> dict:
        if not self.cookie:
            self.login()
        req = urllib.request.Request(f"{APP_URL}{path}", method="POST", data=b"{}",
                                     headers={"Cookie": self.cookie, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode())

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


def parse_iso(value) -> float:
    """ISO timestamp → epoch seconds, 0 when absent or unparseable."""
    if not value or not isinstance(value, str):
        return 0.0
    try:
        from datetime import datetime
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def due(state: dict, key: str) -> bool:
    e = state.get(key)
    if not e:
        return True
    attempts = e.get("attempts", 0)
    if attempts >= MAX_ATTEMPTS:
        return False
    return time.time() - e.get("at", 0) >= retry_after(attempts)


def note_failure(state: dict, key: str, run_id: int, msg: str) -> None:
    st = state.get(key, {"attempts": 0})
    attempts = st["attempts"] + 1
    state[key] = {"attempts": attempts, "at": time.time(), "error": msg[:300]}
    left = MAX_ATTEMPTS - attempts
    wait = retry_after(attempts)
    tail = (f"retrying in {wait // 60} min ({left} attempt{'s' if left != 1 else ''} left)"
            if left > 0 else "giving up on this URL — press “Try again” on the run page to restart the attempts")
    log(f"run #{run_id}: failed — {msg[:140]} | {tail}")


def run_once(app: App, scraper) -> int:
    data = app.get("/api/worker/queue")
    jobs = data.get("jobs", [])
    state = load_state()
    done = 0
    for job in jobs:
        run_id = job["runId"]
        if job.get("mode") == "variants":
            # Re-read the listing's options + per-SKU prices only. Always a
            # fresh fetch (the point is new data); the server clears the request.
            u = job["urls"][0]
            key = f"{run_id}:variants"
            if not due(state, key):
                continue
            log(f"run #{run_id}: re-reading variants from {u['url'][:70]}")
            try:
                folder = scraper.scrape(u["url"], refresh=True)
                scraper.push_to_app(APP_URL, str(run_id), folder, describe=False, password=app.password, mode="variants")
                state.pop(key, None)
                done += 1
                log(f"run #{run_id}: variants pushed")
            except SystemExit as e:
                note_failure(state, key, run_id, str(e).strip() or f"exit {e.code!r}")
            except Exception as e:
                note_failure(state, key, run_id, f"{type(e).__name__}: {e}")
            save_state(state)
            continue
        # competitors first, product last — the final push triggers the analyst
        urls = sorted(job["urls"], key=lambda u: 0 if u["role"] == "competitor" else 1)
        # "Try again" on the run page: forget the failures older than the request.
        retry_at = parse_iso(job.get("retryAt"))
        if retry_at:
            for u in urls:
                key = f"{run_id}:{u['url']}"
                if key in state and state[key].get("at", 0) < retry_at:
                    state.pop(key, None)
                    log(f"run #{run_id}: retry requested from the run page — attempts reset")
        pending = [u for u in urls if due(state, f"{run_id}:{u['url']}")]
        if not pending:
            continue
        pushed_any = False
        for u in pending:
            key = f"{run_id}:{u['url']}"
            log(f"run #{run_id}: scraping {u['role']} page {u['url'][:70]}")
            try:
                # Re-fetch storefront pages every time (cheap, and a fixed
                # scraper should apply immediately); keep the 7-day cache for
                # AliExpress, where every fetch counts against the rate limit.
                fresh = "aliexpress." not in u["url"].lower()
                folder = scraper.scrape(u["url"], refresh=fresh)
                # describe=0 on every push; one analyst call per run comes after the loop
                scraper.push_to_app(APP_URL, str(run_id), folder, describe=False, password=app.password)
                state.pop(key, None)
                done += 1
                pushed_any = True
                log(f"run #{run_id}: pushed")
            except SystemExit as e:      # the scraper reports hard failures via sys.exit
                note_failure(state, key, run_id, str(e).strip() or f"exit {e.code!r}")
            except Exception as e:
                note_failure(state, key, run_id, f"{type(e).__name__}: {e}")
            save_state(state)
        # Write the description from whatever pages the run now has — even if
        # the supplier page failed this round, the brand pages are enough for a
        # first draft. When the supplier page lands on a later pass, this runs
        # again and the analyst rewrites with it as the source of truth.
        if pushed_any:
            try:
                app.post(f"/api/runs/{run_id}/product-describe")
                log(f"run #{run_id}: description written")
            except Exception as e:
                log(f"run #{run_id}: description failed — {type(e).__name__}: {e}")
    return done


def main() -> None:
    once = "--once" in sys.argv
    # The scraper file has a hyphen in its name; load it by path.
    spec = importlib.util.spec_from_file_location("supplier_scrape", Path(__file__).resolve().parent / "supplier-scrape.py")
    scraper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scraper)
    scraper.JSON_MODE = True    # keep the scraper's chatter off stdout formatting; we log ourselves

    here = Path(__file__).resolve().parent
    watched = [here / "local-worker.py", here / "supplier-scrape.py"]
    stamp = [p.stat().st_mtime for p in watched]

    app = App()
    while True:
        try:
            app.login()
            break
        except urllib.error.HTTPError as e:
            if e.code == 401:
                log("the app rejected the password stored in the Keychain — re-add it with:\n"
                    "         security add-generic-password -s pipeline-app -a worker -U -w")
            else:
                log(f"login failed (HTTP {e.code}) — retrying in 60s")
        except Exception as e:
            log(f"can't reach {APP_URL} ({e}) — retrying in 60s")
        if once:
            sys.exit(1)
        time.sleep(60)
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
        if [p.stat().st_mtime for p in watched] != stamp:
            log("source changed — restarting")
            os.execv(sys.executable, [sys.executable] + sys.argv)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
