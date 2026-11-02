#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此步骤需要装有 Xcode 的 macOS；Windows 请使用随附 GitHub Actions 云端构建。" >&2
  exit 1
fi
xcodebuild -version
node --test tests/*.test.cjs
plutil -lint WeekNote/Info.plist WeekNote/PrivacyInfo.xcprivacy
xcodebuild -project WeekNote.xcodeproj -scheme WeekNote -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
mkdir -p build/package/Payload build/output
app="build/DerivedData/Build/Products/Release-iphoneos/WeekNote.app"
test -f "$app/www/index.html"
test -f "$app/www/native.js"
/usr/bin/plutil -extract UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes raw -o - "$app/Info.plist"
/usr/bin/plutil -convert xml1 -o build/output/AppInfo.plist "$app/Info.plist"
{
  xcodebuild -version
  /usr/bin/file "$app/WeekNote"
  /usr/bin/xcrun lipo -archs "$app/WeekNote"
} > build/output/BuildInfo.txt
cp -R build/DerivedData/Build/Products/Release-iphoneos/WeekNote.app build/package/Payload/
cd build/package
/usr/bin/zip -qry ../output/WeekNote-iPhone-unsigned.ipa Payload
cd ../..
/usr/bin/shasum -a 256 build/output/WeekNote-iPhone-unsigned.ipa > build/output/SHA256.txt
echo "已生成 build/output/WeekNote-iPhone-unsigned.ipa。未签名，不能直接点击安装；需在自己的设备上自签。"
