import SwiftUI
import UIKit
import WebKit

@main
struct WeekNoteApp: App {
    @UIApplicationDelegateAdaptor(WeekNoteDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            PhoneWebView()
                .background(Color(red: 1, green: 248.0 / 255, blue: 217.0 / 255))
                .ignoresSafeArea(.container)
                .preferredColorScheme(.light)
                .onChange(of: scenePhase) { phase in
                    if phase == .active {
                        ReminderService.shared.applicationDidBecomeActive()
                    } else if phase == .background {
                        WebLifecycle.shared.flushPendingEdits()
                    }
                }
        }
    }
}

@MainActor
final class WeekNoteDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        // Register notification actions before launch completes, including cold starts.
        ReminderService.shared.attach(store: NativeStore.shared)
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        ReminderService.shared.applicationDidBecomeActive()
    }
}

@MainActor
struct PhoneWebView: UIViewRepresentable {
    func makeCoordinator() -> WebHost {
        WebHost(store: NativeStore.shared, reminders: ReminderService.shared)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "host")
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 1, green: 248.0 / 255, blue: 217.0 / 255, alpha: 1)
        view.scrollView.backgroundColor = view.backgroundColor
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsBackForwardNavigationGestures = false
        view.navigationDelegate = NavigationGuard.shared
        NavigationGuard.shared.host = context.coordinator
        context.coordinator.webView = view
        WebLifecycle.shared.webView = view
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            view.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: WebHost) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "host", contentWorld: .page)
        uiView.navigationDelegate = nil
    }
}

@MainActor
final class WebLifecycle {
    static let shared = WebLifecycle()
    weak var webView: WKWebView?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    func flushPendingEdits() {
        guard let view = webView, backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "保存周纸条") { [weak self] in
            self?.endBackgroundTask()
        }
        view.callAsyncJavaScript("if (window.NoteApp) { await window.NoteApp.flushSaves(); } return true;",
                                 arguments: [:], in: nil, in: .page) { [weak self] _ in
            self?.endBackgroundTask()
        }
    }

    private func endBackgroundTask() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }
}

@MainActor
final class NavigationGuard: NSObject, WKNavigationDelegate {
    static let shared = NavigationGuard()
    weak var host: WebHost?

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        host?.markNotReady()
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        host?.markNotReady()
        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url,
              let root = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true).standardizedFileURL else {
            decisionHandler(.cancel)
            return
        }
        let path = url.standardizedFileURL.path
        decisionHandler(url.isFileURL && (path == root.path || path.hasPrefix(root.path + "/")) ? .allow : .cancel)
    }
}
