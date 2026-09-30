#!/usr/bin/env bash
# Starts the local speech server on this Mac only (127.0.0.1:8178).
set -euo pipefail
DIR="${WHISPER_DIR:-$HOME/whisper.cpp}"
MODEL="${WHISPER_MODEL:-base.en}"
BIN="$DIR/build/bin/whisper-server"
if [ ! -x "$BIN" ]; then
  echo "The speech server is not built yet. Run: npm run speech:setup"
  exit 1
fi
exec "$BIN" -m "$DIR/models/ggml-$MODEL.bin" --host 127.0.0.1 --port 8178 -l en
