import WidgetKit
import SwiftUI
struct BudgetEntry: TimelineEntry { let date: Date; let snapshot: BudgetSnapshot? }
struct BudgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> BudgetEntry { BudgetEntry(date: Date(), snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (BudgetEntry) -> Void) { completion(BudgetEntry(date: Date(), snapshot: context.isPreview ? nil : WidgetStore.read())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BudgetEntry>) -> Void) {
        let now = Date(); let next = Calendar.current.date(byAdding: .minute, value: 30, to: now)!
        completion(Timeline(entries: [BudgetEntry(date: now, snapshot: WidgetStore.read())], policy: .after(next)))
    }
}
struct BudgetWidgetView: View {
    let entry: BudgetEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let snapshot = entry.snapshot, snapshot.isCurrent(at: entry.date), !snapshot.categories.isEmpty {
                ForEach(snapshot.categories) { row in
                    HStack(spacing: 3) {
                        Text(row.name).lineLimit(1).minimumScaleFactor(0.65)
                        Spacer(minLength: 2)
                        Text(row.remaining, format: .currency(code: "USD").precision(.fractionLength(0))).monospacedDigit()
                    }.font(.system(size: 11, weight: .semibold))
                    GeometryReader { geo in ZStack(alignment: .leading) {
                        Capsule().fill(.primary.opacity(0.2))
                        Capsule().fill(.primary).frame(width: geo.size.width * max(0, min(1, row.progress)))
                    }}.frame(height: 3)
                    .accessibilityLabel(row.name + " remaining " + String(Int(row.progress * 100)) + " percent")
                }
            } else { Text("Budget Live").font(.headline); Text("Open app to update").font(.caption) }
        }.privacySensitive().widgetURL(URL(string: "budgetlive://budget"))
    }
}
struct BudgetWidget: Widget {
    let kind = "BudgetRemaining"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BudgetProvider()) { entry in
            if #available(iOS 17.0, *) { BudgetWidgetView(entry: entry).containerBackground(.clear, for: .widget) }
            else { BudgetWidgetView(entry: entry) }
        }
        .configurationDisplayName("Lock Screen budget")
        .description("Current-month remaining budget in your selected categories. Open Budget Live to refresh.")
        .supportedFamilies([.accessoryRectangular])
    }
}
