import Foundation
import WebKit
import UIKit
import UniformTypeIdentifiers

final class WebHost: NSObject, WKScriptMessageHandlerWithReply, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate, NativeEventReceiver {
    weak var webView: WKWebView?
    private let store: NativeStore
    private let reminders: ReminderService
    private var ready = false
    private var pickerReply: ((Any?, String?) -> Void)?
    private var pickerMode: PickerMode?
    private var exportDirectory: URL?
    private enum PickerMode { case importing, exporting }

    init(store: NativeStore, reminders: ReminderService) {
        precondition(Thread.isMainThread)
        self.store = store
        self.reminders = reminders
        super.init()
        reminders.attach(store: store)
        reminders.attachReceiver(self)
    }

    func markNotReady() { ready = false }

    var canReceiveNativeEvents: Bool { ready && webView != nil }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        if Thread.isMainThread { handle(message, reply: replyHandler) }
        else {
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { replyHandler(nil, "页面已经关闭。"); return }
                self.handle(message, reply: replyHandler)
            }
        }
    }

    private func handle(_ message: WKScriptMessage, reply: @escaping (Any?, String?) -> Void) {
        guard message.name == "host", message.frameInfo.isMainFrame,
              let expected = webView, message.webView === expected,
              let url = message.frameInfo.request.url, isBundledPage(url) else {
            reply(nil, "原生接口只允许本机应用主页面使用。")
            return
        }
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            reply(nil, "接口参数格式不正确。")
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        switch action {
        case "loadData":
            do {
                if let state = try store.load() { reply(state, nil) }
                else { reply(NSNull(), nil) }
            }
            catch { reply(nil, error.localizedDescription) }
        case "saveData":
            guard let state = payload["state"] as? [String: Any] else { reply(["ok": false, "error": "缺少有效的任务数据。"], nil); return }
            do { _ = try store.save(state); reply(["ok": true], nil) }
            catch { reply(["ok": false, "error": error.localizedDescription], nil) }
        case "notificationStatus": reminders.notificationStatus { reply($0, nil) }
        case "requestNotificationPermission": reminders.requestNotificationPermission { reply($0, nil) }
        case "importData": presentImport(reply: reply)
        case "exportData": presentExport(reply: reply)
        case "ready":
            ready = true
            reply(true, nil)
            reminders.flushEvents()
        case "openNotificationSettings":
            guard let settings = URL(string: UIApplication.openNotificationSettingsURLString) else { reply(nil, "无法打开通知设置。"); return }
            UIApplication.shared.open(settings, options: [:]) { opened in
                if opened { reply(true, nil) }
                else { reply(nil, "无法打开通知设置，请在系统设置中找到周纸条。") }
            }
        default: reply(nil, "未知的原生操作。")
        }
    }

    private func isBundledPage(_ url: URL) -> Bool {
        guard url.isFileURL, let root = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true) else { return false }
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path
        let pagePath = url.standardizedFileURL.resolvingSymlinksInPath().path
        return pagePath.hasPrefix(rootPath + "/")
    }

    func deliverNativeEvent(_ event: NativeBridgeEvent, completion: @escaping (Bool) -> Void) {
        precondition(Thread.isMainThread)
        guard canReceiveNativeEvents, let webView = webView else { completion(false); return }
        do {
            let packet: [String: Any] = ["name": event.name, "detail": event.detail]
            let bytes = try JSONSerialization.data(withJSONObject: packet)
            guard let json = String(data: bytes, encoding: .utf8) else { completion(false); return }
            // Encode JSON as a string, then JSON.parse it. User text never becomes executable code.
            let quotedBytes = try JSONSerialization.data(withJSONObject: [json])
            guard var quotedArray = String(data: quotedBytes, encoding: .utf8) else { completion(false); return }
            quotedArray = quotedArray.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
                .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
                .replacingOccurrences(of: "<", with: "\\u003c")
            let script = "(() => { const packet = JSON.parse(\(quotedArray)[0]); window.dispatchEvent(new CustomEvent(packet.name, {detail: packet.detail})); return true; })();"
            webView.evaluateJavaScript(script) { _, error in completion(error == nil) }
        } catch { completion(false) }
    }

    private func presenter() -> UIViewController? {
        guard let root = webView?.window?.rootViewController else { return nil }
        var current = root
        while let presented = current.presentedViewController { current = presented }
        return current
    }

    private func beginPicker(_ picker: UIDocumentPickerViewController, mode: PickerMode, reply: @escaping (Any?, String?) -> Void) {
        guard pickerReply == nil else {
            // An unrelated request must not remove a file an active export picker is using.
            reply(["ok": false, "error": "请先完成当前的文件选择，再重试。"], nil)
            return
        }
        guard let parent = presenter(), !(parent is UIDocumentPickerViewController), !parent.isBeingDismissed else {
            reply(["ok": false, "error": "请先完成当前的文件选择，再重试。"], nil)
            clearUnusedExport()
            return
        }
        pickerReply = reply
        pickerMode = mode
        picker.delegate = self
        picker.shouldShowFileExtensions = true
        picker.presentationController?.delegate = self
        parent.present(picker, animated: true)
        picker.presentationController?.delegate = self
    }

    private func presentImport(reply: @escaping (Any?, String?) -> Void) {
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.json], asCopy: true)
        beginPicker(picker, mode: .importing, reply: reply)
    }

    private func presentExport(reply: @escaping (Any?, String?) -> Void) {
        guard pickerReply == nil else { reply(["ok": false, "error": "请先完成当前文件选择。"], nil); return }
        do {
            let state = try store.load() ?? ["tasks": [:], "notes": [:]]
            let bytes = try NativeStore.encode(state)
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("WeekNoteExport-\(UUID().uuidString)", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            exportDirectory = directory
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd"
            let filename = directory.appendingPathComponent("周纸条备份-\(formatter.string(from: Date())).json")
            try bytes.write(to: filename, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            let picker = UIDocumentPickerViewController(forExporting: [filename], asCopy: true)
            beginPicker(picker, mode: .exporting, reply: reply)
        } catch {
            clearUnusedExport()
            reply(["ok": false, "error": "无法导出备份：\(error.localizedDescription)"], nil)
        }
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        precondition(Thread.isMainThread)
        guard let mode = pickerMode else { return }
        switch mode {
        case .exporting: finishPicker(["ok": true])
        case .importing:
            guard let url = urls.first else { finishPicker(["ok": false, "cancelled": true]); return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            do {
                let state = try NativeStore.decode(data: NativeStore.readLimited(url))
                // Selecting a file never commits it. JavaScript merges and saves after validation.
                finishPicker(["ok": true, "state": state])
            } catch { finishPicker(["ok": false, "error": "无法导入备份：\(error.localizedDescription)"]) }
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        finishPicker(["ok": false, "cancelled": true])
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        if pickerReply != nil { finishPicker(["ok": false, "cancelled": true]) }
    }

    private func finishPicker(_ result: [String: Any]) {
        let reply = pickerReply
        pickerReply = nil
        pickerMode = nil
        clearUnusedExport()
        reply?(result, nil)
    }

    private func clearUnusedExport() {
        if let directory = exportDirectory { try? FileManager.default.removeItem(at: directory) }
        exportDirectory = nil
    }
}
