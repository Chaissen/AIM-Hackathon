#!/bin/sh
# Pages a doctor: plays Take That's "Patience" in Google Chrome at full volume.
set -eu

url='https://www.youtube.com/watch?v=273eSvOwpKk'

osascript -e 'set volume output volume 100 without output muted'

# Open the video in a new tab of the front window and bring Chrome to the front.
osascript - "$url" <<'EOF'
on run argv
  tell application "Google Chrome"
    if (count of windows) = 0 then
      make new window
      set URL of active tab of front window to item 1 of argv
    else
      tell front window to make new tab with properties {URL:item 1 of argv}
    end if
    set minimized of front window to false
    activate
  end tell
end run
EOF

# Raise YouTube's own player volume too. This needs Chrome's
# "Allow JavaScript from Apple Events"; without it, the step is skipped.
sleep 5
osascript >/dev/null 2>&1 <<'EOF' || true
tell application "Google Chrome" to execute active tab of front window javascript "const p = document.getElementById('movie_player'); if (p) { p.unMute(); p.setVolume(100); p.playVideo(); }"
EOF
