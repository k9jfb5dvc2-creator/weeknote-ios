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
cp -R build/DerivedData/Build/Products/Release-iphoneos/WeekNote.app build/package/Payload/
cd build/package
/usr/bin/zip -qry ../output/WeekNote-iPhone-unsigned.ipa Payload
cd ../..
/usr/bin/shasum -a 256 build/output/WeekNote-iPhone-unsigned.ipa > build/output/SHA256.txt
echo "已生成 build/output/WeekNote-iPhone-unsigned.ipa。未签名，不能直接点击安装；需在自己的设备上自签。"
