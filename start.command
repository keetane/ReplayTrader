#!/bin/zsh

set -u

app_dir="/Users/keetane/Documents/apps/tv"
log_file="/tmp/replay-trader-tv.log"
app_url="http://127.0.0.1:5173/"

# Finder-launched scripts do not always inherit the terminal's PATH.
if [[ -s "/Users/keetane/.nvm/nvm.sh" ]]; then
  source "/Users/keetane/.nvm/nvm.sh"
  nvm use --silent default >/dev/null 2>&1 || true
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

cd "$app_dir" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "npmが見つかりません。Node.jsをインストールしてください。"
  read -r
  exit 1
fi

: > "$log_file"
npm run dev > "$log_file" 2>&1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ready=0
for attempt in {1..30}; do
  if /usr/bin/curl -sf "$app_url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -eq 1 ]]; then
  /usr/bin/open "$app_url"
else
  echo "アプリを起動できませんでした。ログ: $log_file"
  /usr/bin/tail -40 "$log_file"
  read -r
  exit 1
fi

wait "$server_pid"
