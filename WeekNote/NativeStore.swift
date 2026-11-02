import Foundation
import CoreFoundation

enum NativeStoreError: LocalizedError {
    case invalid(String)
    case unreadable(String)

    var errorDescription: String? {
        switch self {
        case .invalid(let message), .unreadable(let message): return message
        }
    }
}

/// All state access and mutation is serialized on the main thread, including notification actions.
final class NativeStore {
    typealias State = [String: Any]
    enum TaskAction { case done, snooze10m }

    static let shared = NativeStore()
    static let maximumBytes = 10 * 1024 * 1024

    let directoryURL: URL
    let fileURL: URL
    let backupURL: URL
    private(set) var state: State?
    private(set) var loadError: Error?
    var didSave: ((State) -> Void)?
    private var loaded = false

    init(directoryURL: URL? = nil) {
        let applicationSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        self.directoryURL = directoryURL ?? applicationSupport.appendingPathComponent("WeekNote", isDirectory: true)
        self.fileURL = self.directoryURL.appendingPathComponent("weekly-data.json")
        self.backupURL = self.directoryURL.appendingPathComponent("weekly-data.json.bak")
    }

    @discardableResult
    func load() throws -> State? {
        precondition(Thread.isMainThread)
        if let error = loadError { throw error }
        if loaded { return state }
        var failures: [String] = []
        for url in [fileURL, backupURL] where FileManager.default.fileExists(atPath: url.path) {
            do {
                let value = try Self.decode(data: Self.readLimited(url))
                state = value
                loaded = true
                return value
            } catch { failures.append("\(url.lastPathComponent)：\(error.localizedDescription)") }
        }
        if !failures.isEmpty {
            let error = NativeStoreError.unreadable("本机数据及备份无法读取，已停止保存以保护原文件。\n" + failures.joined(separator: "\n"))
            loadError = error
            throw error
        }
        loaded = true
        return nil
    }

    @discardableResult
    func save(_ value: State) throws -> State {
        precondition(Thread.isMainThread)
        _ = try load() // A failed load must never be treated as a new, empty database.
        let normalized = try Self.validate(value)
        let bytes = try Self.encode(normalized)
        let manager = FileManager.default
        try manager.createDirectory(at: directoryURL, withIntermediateDirectories: true)
        if manager.fileExists(atPath: fileURL.path) {
            if let previous = try? Self.readLimited(fileURL), (try? Self.decode(data: previous)) != nil {
                try previous.write(to: backupURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            } else {
                // A fallback load leaves the damaged primary untouched; preserve it before repair.
                let preserved = directoryURL.appendingPathComponent("weekly-data.corrupt-\(UUID().uuidString).json")
                try manager.copyItem(at: fileURL, to: preserved)
            }
        }
        try bytes.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        state = normalized
        loaded = true
        didSave?(normalized)
        return normalized
    }

    /// Stale notification actions cannot undo a newer reminder edit or resurrect completed tasks.
    @discardableResult
    func taskAction(id: String, action: TaskAction, expectedReminder: String? = nil, now: Date = Date()) throws -> [String: Any]? {
        precondition(Thread.isMainThread)
        guard var next = try load(), var days = next["tasks"] as? [String: Any] else { return nil }
        for (date, value) in days {
            guard var list = value as? [[String: Any]], let index = list.firstIndex(where: { ($0["id"] as? String) == id }) else { continue }
            var task = list[index]
            if let expected = expectedReminder, task["reminder"] as? String != expected { return nil }
            switch action {
            case .done: task["done"] = true
            case .snooze10m:
                guard task["done"] as? Bool != true else { return nil }
                task["reminder"] = Self.isoString(now.addingTimeInterval(10 * 60))
            }
            list[index] = task
            days[date] = list
            next["tasks"] = days
            _ = try save(next)
            return ["id": id, "done": task["done"] ?? false, "reminder": task["reminder"] ?? NSNull()]
        }
        return nil
    }

    static func readLimited(_ url: URL) throws -> Data {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        if let size = attributes[.size] as? NSNumber, size.int64Value > Int64(maximumBytes) {
            throw NativeStoreError.invalid("备份超过 10 MB，请分批导入。")
        }
        let bytes = try Data(contentsOf: url)
        guard bytes.count <= maximumBytes else { throw NativeStoreError.invalid("备份超过 10 MB。") }
        return bytes
    }

    static func decode(data: Data) throws -> State {
        guard data.count <= maximumBytes else { throw NativeStoreError.invalid("备份超过 10 MB。") }
        let object = try JSONSerialization.jsonObject(with: data)
        guard let dictionary = object as? State else { throw NativeStoreError.invalid("文件不是有效的周纸条备份。") }
        return try validate(dictionary)
    }

    static func encode(_ state: State) throws -> Data {
        guard JSONSerialization.isValidJSONObject(state) else { throw NativeStoreError.invalid("数据包含无法保存的内容。") }
        let bytes = try JSONSerialization.data(withJSONObject: state, options: [.prettyPrinted, .sortedKeys])
        guard bytes.count <= maximumBytes else { throw NativeStoreError.invalid("数据超过 10 MB。") }
        return bytes
    }

    static func validate(_ raw: State) throws -> State {
        guard JSONSerialization.isValidJSONObject(raw) else { throw NativeStoreError.invalid("数据不是有效的 JSON。") }
        let original = try JSONSerialization.data(withJSONObject: raw)
        guard original.count <= maximumBytes else { throw NativeStoreError.invalid("数据超过 10 MB。") }
        guard let taskDays = raw["tasks"] as? [String: Any] else { throw NativeStoreError.invalid("备份缺少有效的任务数据。") }
        var days: [String: Any] = [:]
        var identifiers = Set<String>()
        var count = 0
        for (date, value) in taskDays {
            guard validDateKey(date), let list = value as? [Any] else { throw NativeStoreError.invalid("任务日期或列表格式不正确。") }
            var tasks: [[String: Any]] = []
            for item in list {
                count += 1
                guard count <= 50_000 else { throw NativeStoreError.invalid("任务数量超过 50000 条。") }
                guard var task = item as? [String: Any],
                      let id = task["id"] as? String, !id.isEmpty, id.utf16.count <= 200,
                      let text = task["text"] as? String, text.utf16.count <= 10_000,
                      let done = task["done"] as? NSNumber,
                      CFGetTypeID(done) == CFBooleanGetTypeID() else {
                    throw NativeStoreError.invalid("任务内容格式不正确。")
                }
                guard identifiers.insert(id).inserted else { throw NativeStoreError.invalid("备份中存在重复的任务编号。") }
                if let reminder = task["reminder"], !(reminder is NSNull) {
                    guard let string = reminder as? String, reminderDate(string) != nil else {
                        throw NativeStoreError.invalid("任务提醒时间必须是有效的 ISO 时间。")
                    }
                } else { task["reminder"] = NSNull() }
                task["done"] = done.boolValue
                task["priority"] = task["priority"] as? String == "high" ? "high" : "normal"
                tasks.append(task)
            }
            days[date] = tasks
        }
        var notes: [String: String] = [:]
        if let value = raw["notes"] {
            guard let noteDays = value as? [String: Any] else { throw NativeStoreError.invalid("便签数据格式不正确。") }
            for (date, value) in noteDays {
                guard validDateKey(date), let text = value as? String, text.utf16.count <= 100_000 else {
                    throw NativeStoreError.invalid("便签日期或内容格式不正确。")
                }
                notes[date] = text
            }
        }
        var result = raw // Preserve createdAt and every other valid, unknown JSON field.
        result["tasks"] = days
        result["notes"] = notes
        return result
    }

    static func validDateKey(_ value: String) -> Bool {
        guard value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return false }
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, (1...9999).contains(parts[0]) else { return false }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)
        guard let date = calendar.date(from: components) else { return false }
        let actual = calendar.dateComponents([.year, .month, .day], from: date)
        return actual.year == parts[0] && actual.month == parts[1] && actual.day == parts[2]
    }

    private static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private static let basicISO = ISO8601DateFormatter()

    static func reminderDate(_ value: String) -> Date? {
        let pattern = "^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]{1,9})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])\\z"
        guard value.range(of: pattern, options: .regularExpression) != nil,
              validDateKey(String(value.prefix(10))) else { return nil }
        return fractionalISO.date(from: value) ?? basicISO.date(from: value)
    }

    static func isoString(_ date: Date) -> String { fractionalISO.string(from: date) }
}
