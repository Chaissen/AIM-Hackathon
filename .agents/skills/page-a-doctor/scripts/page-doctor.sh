#!/bin/sh
# Pages a doctor: plays Take That's "Patience" in Google Chrome at full volume.
set -eu

url='https://www.youtube.com/watch?v=273eSvOwpKk'

osascript -e 'set volume output volume 100 without output muted'
open -a 'Google Chrome' "$url"

# Raise YouTube's own player volume too. This needs Chrome's
# "Allow JavaScript from Apple Events"; without it, the step is skipped.
sleep 5
osascript >/dev/null 2>&1 <<'EOF' || true
tell application "Google Chrome" to execute active tab of front window javascript "const p = document.getElementById('movie_player'); if (p) { p.unMute(); p.setVolume(100); p.playVideo(); }"
EOF
