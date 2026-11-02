# 周纸条 · iPhone 原生版

这是包含原生 iOS 本地通知与手机界面的完整 Xcode 工程。安装到手机后显示为“周纸条”。最低系统为 iOS 16。

当前交付是工程与构建流程，尚未在此 Windows 电脑上编译成 IPA 或完成真机安装。`WeekNote-iPhone-unsigned.ipa` 只有在 Mac 或云端构建成功后才会生成；未签名包还需要以你自己的 Apple 账号签名。

## 功能

- 黄色便签风格，七天日期条，逐日查看任务和随手记。
- 直接书写时自动编号 1、2、3…；手机键盘上方有下一项、同项换行和完成按钮。
- 创建、编辑、完成、删除任务，重要标记、日期与可选时间提醒。
- iOS 系统本地提醒，以及通知中的完成、延后十分钟操作。
- 搜索筛选、周进度、JSON 导入合并与导出备份。
- 本地离线保存。Windows 版导出的 JSON 可在手机设置页导入。两端可通过备份文件迁移内容。

首次设置提醒时需要在 App 内允许通知。已经交给系统排程的提醒不依赖网页保持打开；通知是否显示横幅或发声仍受手机通知权限、专注模式等系统设置影响。App 会安排最近的最多 60 条未来提醒，超出时在提醒状态里显示，后续打开 App 时继续安排。

## 没有 Mac：云端编译，再用 Windows 自签安装

1. 在自己的 GitHub 账号中新建一个仓库，例如 `weeknote-ios`。公开仓库会公开应用源码，标准公共构建可免费使用；个人便签备份不应放进仓库。
2. 将本文件夹内容完整放到仓库根目录，包括 `.github/workflows/build-ios.yml`、`WeekNote`、`WeekNote.xcodeproj`、`scripts` 和 `tests`。请勿上传你导出的个人备份、Apple 密码或签名证书。
3. 打开仓库的 **Actions → Build iPhone app → Run workflow**。只有手动启动才会编译，上传工程不会自动消耗构建额度。
4. 构建成功后，在该次运行底部的 Artifacts 下载 `WeekNote-iPhone-unsigned`。解压后得到未签名 `.ipa` 与 SHA256 校验文件。
5. 按 [AltStore Classic 的 Windows 官方安装说明](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows)安装 AltServer，并通过 USB 连接自己的 iPhone。Apple 账号和密码只在你自己电脑上的安装工具中输入，不发送到聊天或写进云端构建文件。
6. 可在 Windows 中按住 Shift 点击 AltServer 托盘图标，选择 **Sideload .ipa…**，选择构建得到的 IPA；也可通过 AltStore Classic 的 My Apps 导入。由你自己完成账号登录、手机信任和开发者模式等系统步骤。
7. 打开手机上的“周纸条”，设置第一条提醒，再允许通知。

免费 Apple 账号的个人签名有效期为 7 天，需要在到期前刷新；AltStore Classic 可配合运行中的 AltServer 刷新。请勿通过删除 App 续签，以免删除本机数据。详情见 [AltStore 使用说明](https://faq.altstore.io/altstore-classic/your-altstore)与 [Apple 个人开发账号说明](https://developer.apple.com/help/account/basics/about-your-developer-account)。

云端构建使用 GitHub 的 macOS runner，会消耗账号的 Actions 额度；私有仓库额度不足时请先检查账号计费设置，不要直接开启付费构建。当前工作流不读取任何证书或 Apple 密码，也不会自动发布到 App Store。

## 有 Mac 时

1. 用 Xcode 打开 `WeekNote.xcodeproj`，选择 `WeekNote`。
2. 在 Signing & Capabilities 里选择自己的 Team，保持 Automatically manage signing。若 Bundle Identifier 已被占用，改成自己唯一的标识。
3. 连接自己的 iPhone，由你完成手机提示的信任和开发者模式步骤。
4. 选择手机作为运行目标，按 Xcode 的 Run。

只编译未签名 IPA 可执行 `bash scripts/build-ios.sh`。此脚本需要 macOS、Xcode 和 Node.js。

## 检查与工程结构

`node --test tests/*.test.cjs` 检查可复用的日期、编号和手机桥接逻辑。它不等同于 Swift 编译或 iPhone 真机验证。Mac 和真机的检查项目见 `tests/README.md`。

- `WeekNoteApp.swift`：原生 App 入口、WebView 与页面导航边界。
- `NativeStore.swift`：本机 JSON 保存、校验和备份。
- `ReminderService.swift`：系统提醒排程、通知操作与冷启动事件。
- `WebHost.swift`：本地页面和 iOS 之间的接口、文件选择与导出。
- `www`：随 App 一起打包的离线手机界面。

不需要运行网站服务器，不需要注册应用内账号。个人数据不会随此工程包上传；导出备份文件时由你选择存放位置。
