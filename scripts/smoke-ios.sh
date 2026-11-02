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
# iOS 18.5 Simulator omits a Swift WebKit overlay lookup path for apps targeting
# iOS <=18.3. Use WebKit's documented simulator-only runtime workaround, without
# changing the iPhone deployment target or packaging simulator libraries in IPA.
# https://bugs.webkit.org/show_bug.cgi?id=293831#c2
runtime_id="$(xcrun simctl list devices available --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const e=Object.entries(JSON.parse(s).devices).find(([,ds])=>ds.some(d=>d.udid===process.argv[1]));if(!e)throw Error('Runtime not found');process.stdout.write(e[0]);});" "$device")"
runtime_path="$(xcrun simctl list runtimes --json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const r=JSON.parse(s).runtimes.find(r=>r.identifier===process.argv[1]);if(!r?.bundlePath)throw Error('Runtime path not found');process.stdout.write(r.bundlePath);});" "$runtime_id")"
fallback="$runtime_path/Contents/Resources/RuntimeRoot/System/Cryptexes/OS/usr/lib/swift"
if [[ -f "$fallback/libswiftWebKit.dylib" ]]; then
  export SIMCTL_CHILD_DYLD_FALLBACK_LIBRARY_PATH="$fallback"
  printf 'WebKit simulator runtime fallback: %s\n' "$fallback" | tee build/output/SimulatorEnvironment.txt
fi
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
