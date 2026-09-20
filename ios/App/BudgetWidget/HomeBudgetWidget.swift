import WidgetKit
import SwiftUI
struct HomeBudgetView: View {
    let entry: BudgetEntry
    @Environment(\.widgetFamily) private var family
    private var large: Bool { family == .systemLarge }
    var body: some View {
        VStack(alignment: .leading, spacing: large ? 20 : 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("BUDGET LIVE").font(.system(size: 10, weight: .bold)).tracking(1.5).foregroundStyle(.green)
                    Text("Left this month").font(.system(size: large ? 23 : 15, weight: .bold))
                }
                Spacer()
                Text(entry.date, format: .dateTime.month(.abbreviated)).font(.caption).foregroundStyle(.secondary)
            }
            if let snapshot = entry.snapshot, snapshot.isCurrent(at: entry.date), !snapshot.categories.isEmpty {
                ForEach(snapshot.categories) { row in
                    VStack(alignment: .leading, spacing: large ? 8 : 4) {
                        HStack {
                            Text(row.name).font(.system(size: large ? 16 : 12, weight: .medium)).lineLimit(1).minimumScaleFactor(0.8)
                            Spacer(minLength: 6)
                            Text(row.remaining, format: .currency(code: "USD").precision(.fractionLength(0)))
                                .font(.system(size: large ? 23 : 16, weight: .bold)).monospacedDigit()
                                .foregroundStyle(row.remaining < 0 ? Color.red : Color.primary)
                        }
                        GeometryReader { geometry in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.primary.opacity(0.12))
                                Capsule().fill(row.remaining < 0 ? Color.red : Color.green)
                                    .frame(width: geometry.size.width * max(0, min(1, row.progress)))
                            }
                        }.frame(height: large ? 8 : 5)
                        .accessibilityLabel(row.name + " remaining " + String(Int(row.progress * 100)) + " percent")
                        if large { Text(row.remaining < 0 ? "Over budget" : "of " + row.budget.formatted(.currency(code: "USD").precision(.fractionLength(0))) + " monthly budget").font(.caption).foregroundStyle(.secondary) }
                    }
                }
                if large { Spacer(minLength: 0); if let timestamp = snapshot.timestamp { Text("Updated " + timestamp.formatted(date: .omitted, time: .shortened) + " · Tap to refresh").font(.caption2).foregroundStyle(.secondary) } }
            } else {
                Spacer(minLength: 0)
                Text("Open Budget Live to update your categories.").font(.subheadline).foregroundStyle(.secondary)
                Spacer(minLength: 0)
            }
        }.privacySensitive().widgetURL(URL(string: "budgetlive://budget"))
    }
}
struct HomeBudgetWidget: Widget {
    let kind = "HomeBudgetRemaining"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BudgetProvider()) { entry in
            if #available(iOS 17.0, *) { HomeBudgetView(entry: entry).containerBackground(Color(.secondarySystemBackground), for: .widget) }
            else { HomeBudgetView(entry: entry).padding(16) }
        }
        .configurationDisplayName("Budget Live · Monthly remaining")
        .description("See how much is left in three selected budget categories. Choose categories inside Budget Live Settings.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
@main struct BudgetWidgets: WidgetBundle {
    var body: some Widget { HomeBudgetWidget(); BudgetWidget() }
}
