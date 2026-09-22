import Foundation
struct CategoryValue: Codable, Identifiable {
    var id: String { name }
    let name: String
    let budget: Double
    let spent: Double
    let remaining: Double
    let progress: Double
}
struct BudgetSnapshot: Codable {
    let version: Int
    let month: String
    let updatedAt: String
    let categories: [CategoryValue]
    var timestamp: Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: updatedAt)
    }
    func isCurrent(at date: Date) -> Bool {
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM"; formatter.locale = Locale(identifier: "en_US_POSIX")
        guard let saved = timestamp else { return false }
        return version == 1 && month == formatter.string(from: date) && date.timeIntervalSince(saved) < 86400 && date.timeIntervalSince(saved) >= -60
    }
}
enum WidgetStore {
    static var file: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "BudgetAppGroup") as? String else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("budget-widget.json")
    }
    static func read() -> BudgetSnapshot? {
        guard let url = file, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(BudgetSnapshot.self, from: data)
    }
    static func clear() throws { if let file, FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) } }
}
