# 验证说明

本目录的 Node 测试检查实际手机前端的日期、合并、编号和桥接行为。它们不是 Swift 编译、iPhone 真机测试或通知送达证明。Windows 环境没有 Xcode/iOS SDK；需要在 Mac 或 macOS CI 继续完成下面的验证。

## 前端自动验证

在工程根目录运行：

```sh
node --test tests/*.test.cjs
```

测试不访问实际用户数据、不请求通知权限，也不向任何服务上传数据。浏览器预览只能验证网页交互；本地系统提醒应以 iOS App 中的结果为准。

## Mac 编译

安装支持 iOS 16 及当前工程的 Xcode，首次打开并完成组件安装，然后在工程根目录运行：

```sh
xcodebuild -version
xcodebuild -list -project WeekNote.xcodeproj
xcodebuild -project WeekNote.xcodeproj \
  -scheme WeekNote -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath work/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

这一步产出模拟器 App，不能直接安装到 iPhone。需要验证原生代码、资源打包与 WKWebView 加载均成功，编译日志没有错误。随后在 Xcode 中选择签名团队、唯一 Bundle Identifier 和已连接的 iPhone，再运行。归档、签名和导出 IPA 需要有效的 Apple 签名配置；GitHub Actions 中无签名的模拟器构建也不能替代它。

## iPhone 验收

- 首次启动显示正确年月日和周几，七天日期切换、跨月/跨年周切换、回到今天正确。窄屏、横屏、刘海/底部手势区域和放大字体不遮挡新建/保存/取消按钮。
- 点击空白随手记出现 `1. `，中文九宫格/拼音输入确认不会误增编号；软键盘回车新增下一项。在行中间回车、删除整行、跨行选区替换、多行粘贴后文本完整、编号连续、光标停在输入位置。
- `2026.11.2 会议`、`3.14记录`、`12:30开会` 的数字正文完整。离开空编号后不产生空正文；已有内容和编号在杀进程重开后保持一致，编号不会越加越多。
- 软键盘弹出时能看到正在编辑的行；滚动或切换日期后没有大块残留空白，键盘关闭时恢复正常。接入实体键盘时普通回车与 Shift+回车行为明确，输入法合成过程不中断。
- 任务新建、编辑、日期移动、重要标记、完成/恢复、删除撤销、搜索和筛选能在重启后保留。
- 点击设置页的“开启通知”时请求通知权限；未授权或拒绝后显示清楚的权限状态，任务仍保存。允许后设置约两分钟后的任务，分别在前台、锁屏和切至其他 App 时核对通知。
- 锁屏通知中的“完成”和“10 分钟后”先落盘再返回。操作后重新打开 App 并再次重启，完成状态或新提醒时间仍存在；过时或被修改的旧通知不能覆盖任务的新内容。
- 设置超过 60 个未来提醒，确认仅排入最近的一批，界面显示已安排数量和超出数量。打开 App、完成或取消已排任务后核对后续补入；不要把长期不打开 App 时全部未来提醒都必达作为通过条件。
- 已完成任务和取消提醒不再通知；修改提醒时间不保留旧的待通知项目。时区/系统时间变动后重新打开 App，确认显示与下一批排程一致。
- 导出包含任务与随手记的备份到“文件”；导入同一备份两次不重复、不覆盖本机同 ID 的更新。导入后继续写便签或完成任务，再撤销导入，应保留之后的修改。
- 用非 JSON、结构错误、重复任务 ID、超过大小限制的文件测试导入失败，当前数据保持完整。模拟本机数据损坏时应报告错误或恢复备份，不能静默写成空数据。
- 系统文件选择保存或取消后能回到 App；导出的 JSON 可在“文件”App 中自行分享。后台收到通知动作时网页未载入也能完成持久化；再次打开能同步到页面。

## 原生桥审查要点

只允许当前 App 打包页面的主框架调用桥。外部导航、子框架和未知消息方法不能访问任务数据或触发分享。JS 请求 ID 必须对应一次结果，原生错误应以失败结果返回；读取异常不能当作“没有数据”。HTML/JS 中显示用户输入使用文本内容，不能拼接执行脚本。

Apple API 依据：通知代理须在启动结束前绑定，并在处理用户动作后调用完成回调；页面消息可通过 `frameInfo.isMainFrame` 与来源请求核对。[通知代理](https://developer.apple.com/documentation/UserNotifications/UNUserNotificationCenterDelegate)、[通知动作回调](https://developer.apple.com/documentation/usernotifications/unusernotificationcenterdelegate/usernotificationcenter(_:didreceive:withcompletionhandler:))、[WKFrameInfo](https://developer.apple.com/documentation/webkit/wkframeinfo)。
