#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project WeekNote.xcodeproj -scheme WeekNote -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/Simulator \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
device="$(xcrun simctl list devices available --json | node -e "let text='';process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{const all=Object.values(JSON.parse(text).devices).flat().filter(d=>d.isAvailable&&d.name.startsWith('iPhone'));const d=all.find(x=>x.state==='Booted')||all[0];if(!d)throw Error('No available iPhone simulator');process.stdout.write(d.udid);});")"
xcrun simctl boot "$device" || true
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" build/Simulator/Build/Products/Debug-iphonesimulator/WeekNote.app
launch="$(xcrun simctl launch "$device" com.local.weeklystickynote.ios)"
printf '%s\n' "$launch" > build/output/SimulatorLaunch.txt
pid="${launch##*: }"
sleep 5
kill -0 "$pid"
xcrun simctl io "$device" screenshot build/output/iPhoneSimulator.png
xcrun simctl terminate "$device" com.local.weeklystickynote.ios
