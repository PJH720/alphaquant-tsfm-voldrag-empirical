#!/usr/bin/env bash
# One-click live backend for the demo site's live lab (web/ section 3).
#   1. FastAPI on 127.0.0.1:8000 (loopback only; the tunnel is the only way in)
#   2. Cloudflare Quick Tunnel -> public https://<random>.trycloudflare.com
#   3. Prints the site link with ?api=<tunnel> so the page connects without a redeploy
# Ctrl-C stops both. The tunnel URL changes on every start.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-8000}"
SITE="${SITE:-https://alphaquant-voldrag-demo.vercel.app}"
LOG_DIR="${LOG_DIR:-${TMPDIR:-/tmp}/voldrag-live}"
mkdir -p "$LOG_DIR"
TUNNEL_LOG="$LOG_DIR/tunnel.log"
SERVER_LOG="$LOG_DIR/server.log"

command -v cloudflared >/dev/null || { echo "cloudflared not found: https://github.com/cloudflare/cloudflared/releases" >&2; exit 1; }
if curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null; then
  echo "Port $PORT already serves the API; stop it first." >&2; exit 1
fi

cleanup() { kill "${TUNNEL_PID:-}" "${SERVER_PID:-}" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "Starting API server (log: $SERVER_LOG) ..."
(cd "$ROOT" && exec uv run --group live uvicorn voldrag.api.server:app --host 127.0.0.1 --port "$PORT" --limit-concurrency 16 --timeout-keep-alive 5) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
# First start builds and caches the lambda-grid targets (~2 min); later starts take seconds.
for _ in $(seq 1 300); do
  curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "Server exited; see $SERVER_LOG" >&2; tail -20 "$SERVER_LOG" >&2; exit 1; }
  sleep 1
done
curl -s "http://127.0.0.1:$PORT/api/health" | python3 -c '
import json, sys
h = json.load(sys.stdin); g = h["gpu"]; sc = h["self_check"]
print(f"  device: {g.get("name", "cpu")}  CUDA {g.get("cuda_version", "-")}  VRAM {g.get("vram_allocated_process_mb", 0)} MB allocated")
print(f"  self-check vs results.json: ok={sc["ok"]} ({sc.get("values_checked")} values)")
if not sc["ok"]:
    sys.exit("self-check failed: do not present live numbers")
'

echo "Starting Cloudflare Quick Tunnel (log: $TUNNEL_LOG) ..."
: >"$TUNNEL_LOG"
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!
TUNNEL_URL=""
for _ in $(seq 1 60); do
  TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
  [ -n "$TUNNEL_URL" ] && curl -sf "$TUNNEL_URL/api/health" >/dev/null && break
  sleep 1
done
[ -n "$TUNNEL_URL" ] || { echo "No tunnel URL; see $TUNNEL_LOG" >&2; exit 1; }

echo "=========================================================="
echo " LIVE GPU ENGINE PUBLIC URL: $TUNNEL_URL"
echo " Open the site already connected:"
echo "   $SITE/?api=$TUNNEL_URL#live"
echo " (or paste the URL into the site's '백엔드 주소 설정'; it is remembered in that browser)"
echo "=========================================================="
wait -n "$SERVER_PID" "$TUNNEL_PID"
