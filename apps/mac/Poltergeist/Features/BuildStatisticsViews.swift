//
//  BuildStatisticsViews.swift
//  Poltergeist
//

import SwiftUI

// Build statistics dashboard
struct BuildStatisticsDashboard: View {
    let statistics: BuildStatistics

    // Formatter for build durations
    static let buildDurationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.maximumUnitCount = 2
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Build Statistics (24h)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.primary)

            // Statistics grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 12) {
                StatCard(
                    title: "Total Builds",
                    value: "\(statistics.totalBuilds24h)",
                    icon: "hammer.fill",
                    color: .blue
                )

                StatCard(
                    title: "Success Rate",
                    value: String(format: "%.0f%%", statistics.successRate * 100),
                    icon: "checkmark.shield.fill",
                    color: statistics.successRate >= 0.8
                        ? .green : (statistics.successRate >= 0.5 ? .orange : .red)
                )

                StatCard(
                    title: "Avg Build Time",
                    value: BuildStatisticsDashboard.buildDurationFormatter.string(
                        from: statistics.averageBuildTime)
                        ?? String(format: "%.1fs", statistics.averageBuildTime),
                    icon: "clock.fill",
                    color: .purple
                )

                StatCard(
                    title: "Active Now",
                    value: "\(statistics.currentActiveBuilds)",
                    icon: "arrow.triangle.2.circlepath",
                    color: statistics.currentActiveBuilds > 0 ? .blue : .gray
                )
            }
        }
        .padding(12)
        .background(.regularMaterial)
        .cornerRadius(8)
    }
}

// Individual stat card
struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(color)

                Text(title)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Text(value)
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(color.opacity(0.1))
        .cornerRadius(6)
    }
}