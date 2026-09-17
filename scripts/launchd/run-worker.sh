#!/bin/zsh
# Launcher for the pipeline worker, run by launchd from ~/.pipeline-worker.
#
# The repo lives under ~/Desktop, which is iCloud-synced and privacy-protected
# on this Mac. After a reboot a background process can be handed an EMPTY file
# there: python then runs an empty script and exits 0 in silence, launchd
# restarts it, and the worker stays down for hours with nothing in the log
# (Sep 17 2026: ~400 silent restarts until the file was read from a terminal).
# So the worker runs from the copies in this folder. This script cannot refresh
# them (macOS denies zsh/cp access to ~/Desktop from launchd); the worker does
# that itself when the repo copy changes, and only with a copy that reads back
# non-empty and compiles. Seed the folder once from a terminal:
#   mkdir -p ~/.pipeline-worker
#   cp scripts/launchd/run-worker.sh scripts/local-worker.py scripts/supplier-scrape.py ~/.pipeline-worker/
DST="$HOME/.pipeline-worker"
PY="$HOME/.venvs/scrapling/bin/python"
for f in local-worker.py supplier-scrape.py; do
  if [ ! -s "$DST/$f" ]; then
    echo "$(date +%H:%M:%S) launcher: $DST/$f is missing — seed it from a terminal (see run-worker.sh)"
    exit 1
  fi
done
export PIPELINE_WORKER_SRC="$HOME/Desktop/claude/pipeline-app/scripts"
exec "$PY" "$DST/local-worker.py"
