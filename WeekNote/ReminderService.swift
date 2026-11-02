import Foundation
import UserNotifications
import CryptoKit

struct NativeBridgeEvent {
    let identifier = UUID()
    let name: String
    let detail: Any
}

protocol NativeEventReceiver: AnyObject {
    var canReceiveNativeEvents: Bool { get }
    func deliverNativeEvent(_ event: NativeBridgeEvent, completion: @escaping (Bool) -> Void)
}

/// The system owns scheduled local notifications; no running web page or network is required.
final class ReminderService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderService()
    static let categoryIdentifier = "WEEKNOTE_TASK"
    static let doneIdentifier = "WEEKNOTE_DONE"
    static let snoozeIdentifier = "WEEKNOTE_SNOOZE_10M"
    private static let identifierPrefix = "weeknote.task."
    private static let pendingLimit = 60

    private let center: UNUserNotificationCenter
    private var store: NativeStore?
    private weak var receiver: NativeEventReceiver?
    private var events: [NativeBridgeEvent] = []
    private var deliveringEvent = false
    private var generation: UInt64 = 0
    private var synchronizing = false
    private var syncRequested = false
    private var statusWaiters: [([String: Any]) -> Void] = []
    private var operationError: String?

    init(center: UNUserNotificationCenter = .current()) {
        self.center = center
        super.init()
        center.delegate = self // Install as early as application didFinishLaunching.
        let done = UNNotificationAction(identifier: Self.doneIdentifier, title: "完成", options: [])
        let snooze = UNNotificationAction(identifier: Self.snoozeIdentifier, title: "10 分钟后", options: [])
        let category = UNNotificationCategory(identifier: Self.categoryIdentifier, actions: [done, snooze], intentIdentifiers: [], options: [.customDismissAction])
        center.setNotificationCategories([category])
    }

    func attach(store: NativeStore) {
        precondition(Thread.isMainThread)
        guard self.store !== store else { return }
        self.store?.didSave = nil
        self.store = store
        store.didSave = { [weak self] _ in self?.synchronize() }
        do { _ = try store.load() }
        catch { operationError = error.localizedDescription }
        synchronize()
    }

    func attachReceiver(_ receiver: NativeEventReceiver) {
        precondition(Thread.isMainThread)
        self.receiver = receiver
    }

    func flushEvents() {
        precondition(Thread.isMainThread)
        guard !deliveringEvent, let first = events.first,
              let receiver = receiver, receiver.canReceiveNativeEvents else { return }
        deliveringEvent = true
        receiver.deliverNativeEvent(first) { [weak self] delivered in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.deliveringEvent = false
                if delivered, self.events.first?.identifier == first.identifier { self.events.removeFirst() }
                if delivered { self.flushEvents() }
            }
        }
    }

    private func enqueue(name: String, detail: Any) {
        precondition(Thread.isMainThread)
        events.append(NativeBridgeEvent(name: name, detail: detail))
        flushEvents()
    }

    /// Serialize asynchronous scheduling passes. A newer generation always runs after old adds finish.
    func synchronize() {
        precondition(Thread.isMainThread)
        generation &+= 1
        syncRequested = true
        beginSynchronizationIfNeeded()
    }

    func applicationDidBecomeActive() {
        precondition(Thread.isMainThread)
        synchronize()
        // Deliver background mutations before asking JavaScript to reconcile foreground edits.
        enqueue(name: "native-app-active", detail: NSNull())
    }

    func notificationStatus(completion: @escaping ([String: Any]) -> Void) {
        precondition(Thread.isMainThread)
        statusWaiters.append(completion)
        synchronize()
    }

    func requestNotificationPermission(completion: @escaping ([String: Any]) -> Void) {
        precondition(Thread.isMainThread)
        center.requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] _ , error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.operationError = error?.localizedDescription
                self.notificationStatus(completion: completion)
            }
        }
    }

    private struct Candidate {
        let id: String
        let text: String
        let at: String
        let date: Date
        let highPriority: Bool
        var identifier: String {
            Self.requestIdentifier(id)
        }
        private static func requestIdentifier(_ id: String) -> String {
            let digest = SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
            return ReminderService.identifierPrefix + digest
        }
    }

    private func futureCandidates(now: Date) -> [Candidate] {
        guard let days = store?.state?["tasks"] as? [String: Any] else { return [] }
        var result: [Candidate] = []
        for value in days.values {
            guard let tasks = value as? [[String: Any]] else { continue }
            for task in tasks {
                guard task["done"] as? Bool == false,
                      let id = task["id"] as? String,
                      let at = task["reminder"] as? String,
                      let date = NativeStore.reminderDate(at), date > now else { continue }
                result.append(Candidate(id: id, text: task["text"] as? String ?? "未命名任务", at: at, date: date, highPriority: task["priority"] as? String == "high"))
            }
        }
        return result.sorted { $0.date == $1.date ? $0.id < $1.id : $0.date < $1.date }
    }

    private func beginSynchronizationIfNeeded() {
        guard !synchronizing, syncRequested else { return }
        synchronizing = true
        syncRequested = false
        let run = generation
        center.getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async {
                guard let self = self else { return }
                guard self.generation == run else { self.restartSynchronization(); return }
                self.center.getPendingNotificationRequests { [weak self] pending in
                    DispatchQueue.main.async {
                        guard let self = self else { return }
                        guard self.generation == run else { self.restartSynchronization(); return }
                        self.applySynchronization(run: run, settings: settings, pending: pending)
                    }
                }
            }
        }
    }

    private func applySynchronization(run: UInt64, settings: UNNotificationSettings, pending: [UNNotificationRequest]) {
        let candidates = futureCandidates(now: Date())
        let authorization = Self.authorizationName(settings.authorizationStatus)
        // Preserve existing system requests if the database could not be read.
        if let error = store?.loadError {
            completeSynchronization(run: run, authorization: authorization, pending: pending, error: error.localizedDescription)
            return
        }
        let permitted = [UNAuthorizationStatus.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        let desired = permitted ? Array(candidates.prefix(Self.pendingLimit)) : []
        let desiredByID = Dictionary(uniqueKeysWithValues: desired.map { ($0.identifier, $0) })
        let ours = pending.filter { $0.identifier.hasPrefix(Self.identifierPrefix) }
        // Adding the same identifier replaces a pending request. Do not race a separate
        // remove against that replacement; remove only tasks no longer in the desired set.
        let removed = ours.filter { desiredByID[$0.identifier] == nil }.map(\.identifier)
        if !removed.isEmpty { center.removePendingNotificationRequests(withIdentifiers: removed) }
        let existingByID = Dictionary(uniqueKeysWithValues: ours.map { ($0.identifier, $0) })
        let additions = desired.filter { candidate in
            guard let existing = existingByID[candidate.identifier] else { return true }
            return !matches(existing, candidate)
        }
        var remaining = additions.count
        var errors: [String] = []
        let finish: () -> Void = { [weak self] in
            guard let self = self else { return }
            self.center.getPendingNotificationRequests { [weak self] actual in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.completeSynchronization(run: run, authorization: authorization, pending: actual, error: errors.first)
                }
            }
        }
        guard remaining > 0 else { finish(); return }
        for candidate in additions {
            let content = UNMutableNotificationContent()
            content.title = "周纸条提醒"
            content.body = candidate.text.isEmpty ? "有一项待办到时间了" : candidate.text
            content.subtitle = candidate.highPriority ? "重要任务" : ""
            content.categoryIdentifier = Self.categoryIdentifier
            content.threadIdentifier = "weeknote.tasks"
            content.sound = .default
            content.userInfo = ["taskId": candidate.id, "at": candidate.at]
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, candidate.date.timeIntervalSinceNow), repeats: false)
            let request = UNNotificationRequest(identifier: candidate.identifier, content: content, trigger: trigger)
            center.add(request) { error in
                DispatchQueue.main.async {
                    if let error = error { errors.append(error.localizedDescription) }
                    remaining -= 1
                    if remaining == 0 { finish() }
                }
            }
        }
    }

    private func matches(_ request: UNNotificationRequest, _ candidate: Candidate) -> Bool {
        request.content.userInfo["taskId"] as? String == candidate.id &&
        request.content.userInfo["at"] as? String == candidate.at &&
        request.content.body == (candidate.text.isEmpty ? "有一项待办到时间了" : candidate.text) &&
        request.content.subtitle == (candidate.highPriority ? "重要任务" : "")
    }

    private func restartSynchronization() {
        synchronizing = false
        syncRequested = true
        beginSynchronizationIfNeeded()
    }

    private func completeSynchronization(run: UInt64, authorization: String, pending: [UNNotificationRequest], error: String?) {
        guard generation == run, !syncRequested else { restartSynchronization(); return }
        synchronizing = false
        let currentCandidates = futureCandidates(now: Date())
        let eligible = Dictionary(uniqueKeysWithValues: currentCandidates.map { ($0.identifier, $0) })
        let scheduled = pending.filter { request in
            guard let task = eligible[request.identifier] else { return false }
            return matches(request, task)
        }.count
        var status: [String: Any] = ["authorization": authorization, "scheduled": scheduled, "unscheduled": max(0, currentCandidates.count - scheduled)]
        if let message = error ?? operationError { status["error"] = message }
        let callbacks = statusWaiters
        statusWaiters.removeAll()
        callbacks.forEach { $0(status) }
    }

    private static func authorizationName(_ value: UNAuthorizationStatus) -> String {
        switch value {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        @unknown default: return "unknown"
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { completionHandler(); return }
            if self.store == nil { self.attach(store: .shared) }
            let info = response.notification.request.content.userInfo
            guard let id = info["taskId"] as? String, let at = info["at"] as? String else { completionHandler(); return }
            switch response.actionIdentifier {
            case Self.doneIdentifier, Self.snoozeIdentifier:
                do {
                    let action: NativeStore.TaskAction = response.actionIdentifier == Self.doneIdentifier ? .done : .snooze10m
                    if let change = try self.store?.taskAction(id: id, action: action, expectedReminder: at),
                       let state = self.store?.state {
                        self.enqueue(name: "native-data-changed", detail: ["state": state, "change": change])
                    }
                    self.operationError = nil
                    center.removeDeliveredNotifications(withIdentifiers: [response.notification.request.identifier])
                    // Keep the background response alive until the snoozed request is accepted.
                    self.notificationStatus { _ in completionHandler() }
                } catch {
                    self.operationError = "通知操作未保存：\(error.localizedDescription)"
                    completionHandler()
                }
            case UNNotificationDefaultActionIdentifier:
                self.enqueue(name: "native-focus-task", detail: id)
                completionHandler()
            default: completionHandler()
            }
        }
    }
}
