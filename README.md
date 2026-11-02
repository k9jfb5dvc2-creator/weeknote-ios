# 周纸条 · iPhone 原生版

适用 iOS 16 及以上，安装后显示为“周纸条”。保留黄色便签、七天日期条和自动编号随手记，支持任务编辑、完成撤销、搜索筛选、系统本地提醒与 JSON 备份。

**已在云端 Mac / Xcode 16.4 成功编译 iPhone arm64 安装包，并下载 `WeekNote-iPhone-unsigned.ipa`。**[成功的构建记录](https://github.com/k9jfb5dvc2-creator/weeknote-ios/actions/runs/41386344973)

IPA 尚未签名，不能在手机上点开即装，需要用自己的 Apple 账号签名。**已通过 iOS 18.5 模拟器启动检查并核对实际界面截图；尚未完成你的 iPhone 真机安装或系统通知实测。**[公开源码](https://github.com/k9jfb5dvc2-creator/weeknote-ios)不包含你的个人笔记。

本次 IPA 的 SHA256：

```text
4AF63268CFA7BBC1A9603826DF8CDC93A37746BC83820C6857E0B5AC59265952
```

## 用 Windows 安装

1. 按 [AltStore Windows 官方教程](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows)安装 AltServer，以及教程指定的 Apple 官网版 iTunes、iCloud。启动 AltServer，用 USB 连接已解锁的 iPhone，由你完成“信任此电脑”和 iTunes 的 Wi-Fi 同步设置。
2. 点击 Windows 右下角 AltServer 图标，选择 **Install AltStore → 你的 iPhone**。Apple 账号和密码只由你在本机安装工具输入，不发送到聊天。GitHub 登录用于代码与编译，Apple 登录用于手机安装签名，两者不同。
3. 手机按提示信任开发者；iOS 16+ 的“隐私与安全性 → 开发者模式”和重启确认由你自行完成。将 IPA 保存到手机“文件”，在 AltStore → **My Apps → ＋** 中选择它。
4. 也可在 Windows 按住 **Shift** 点击 AltServer 图标，选择 **Sideload .ipa…** 直接安装；该方式需要自行定期重新签名安装。[官方说明](https://faq.altstore.io/release-notes/altserver)
5. 打开周纸条，到 **设置 → 开启通知**，在系统弹窗中点“允许”。新建一个几分钟后的提醒，分别在前台和锁屏时确认效果。

免费账号签名 7 天到期。通过 AltStore 安装时，保持 AltServer 运行、手机通过 USB 或同一 Wi-Fi 连接，到期前在 **My Apps → Refresh All** 刷新。Shift 直接安装的包需按原方式重新签名安装。**续签不要删除 App，以免丢失本机便签。**[刷新说明](https://faq.altstore.io/altstore-classic/your-altstore)

## 使用与迁移

- 随手记回车自动出现 1、2、3；键盘上方可点“下一项”“同项换行”“完成”。编号只显示，正文独立保存。
- 任务可选日期、时间和重要标记。通知提供“完成”“10 分钟后”操作；通知显示及声音受 iPhone 通知和专注模式设置影响。
- App 安排最近最多 60 条未来提醒，超出数量会显示；后续打开 App 时继续安排。
- Windows 版 **更多 → 导出备份** 得到 JSON，传到手机“文件”，再用手机版 **设置 → 导入并合并**。重复导入不会重复任务，导入后可撤销。
- 数据离线保存在本机，没有应用内账号，也不自动跨设备同步；可在设置页导出备份。

## 后续自行编译

打开源码仓库 **Actions → Build iPhone app → Run workflow**；在构建产物中下载 `WeekNote-iPhone-unsigned`。有 Mac 时，也可用 Xcode 打开 `WeekNote.xcodeproj`，选择自己的签名 Team 后运行到 iPhone，或执行 `bash scripts/build-ios.sh` 生成未签名包。

`node --test tests/*.test.cjs` 检查日期、编号、手机桥接与工程资源。编译、模拟器启动及真机提醒是不同的验证项目；详细清单见工程中的 `tests/README.md`。
