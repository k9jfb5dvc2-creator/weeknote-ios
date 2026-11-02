#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project WeekNote.xcodeproj -scheme WeekNote -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/Simulator \
  ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=YES \
  CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= build
device="$(xcrun simctl list devices available --json | node -e "let text='';process.stdin.on('data',d=>text+=d);process.stdin.on('end',()=>{const all=Object.values(JSON.parse(text).devices).flat().filter(d=>d.isAvailable&&d.name.startsWith('iPhone'));const d=all.find(x=>x.state==='Booted')||all[0];if(!d)throw Error('No available iPhone simulator');process.stdout.write(d.udid);});")"
xcrun simctl boot "$device" || true
xcrun simctl bootstatus "$device" -b
app=build/Simulator/Build/Products/Release-iphonesimulator/WeekNote.app
/usr/bin/codesign --verify --deep --strict "$app"
collect_diagnostics() {
  xcrun simctl io "$device" screenshot build/output/iPhoneSimulator.png || true
  xcrun simctl spawn "$device" log show --last 3m --style compact \
    --predicate 'process == "WeekNote" OR (process == "runningboardd" AND eventMessage CONTAINS "com.local.weeklystickynote.ios")' \
    > build/output/SimulatorLog.txt 2>&1 || true
  find "$HOME/Library/Logs/DiagnosticReports" -maxdepth 2 -name 'WeekNote*' -type f \
    -exec cp {} build/output/ \; 2>/dev/null || true
}
trap collect_diagnostics EXIT
xcrun simctl install "$device" "$app"
launch="$(xcrun simctl launch "$device" com.local.weeklystickynote.ios)"
printf '%s\n' "$launch" | tee build/output/SimulatorLaunch.txt
pid="${launch##*: }"
sleep 10
kill -0 "$pid"
