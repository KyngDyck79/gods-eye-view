#!/usr/bin/env bash
# Builds the local speech server (whisper.cpp) in ~/whisper.cpp and downloads
# the base.en model. Homebrew's whisper-cpp package does not include the
# server, so it is built from source (Metal is used automatically on Apple
# Silicon). Safe to run again; finished steps are skipped.
set -euo pipefail
DIR="${WHISPER_DIR:-$HOME/whisper.cpp}"
MODEL="${WHISPER_MODEL:-base.en}"

command -v git >/dev/null || { echo "git is missing. Run: xcode-select --install"; exit 1; }
command -v cmake >/dev/null || { echo "cmake is missing. Run: brew install cmake"; exit 1; }

if [ ! -d "$DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git "$DIR"
fi
cd "$DIR"
if [ ! -x build/bin/whisper-server ]; then
  cmake -B build
  cmake --build build -j --config Release
fi
if [ ! -f "models/ggml-$MODEL.bin" ]; then
  sh ./models/download-ggml-model.sh "$MODEL"
fi

echo
echo "Speech server is ready. Start it with:"
echo
echo "  npm run speech"
echo
echo "and make sure .env contains:"
echo
echo "  WHISPER_SERVER_URL=http://127.0.0.1:8178"
