//
//  EmptyStateView.swift
//  Poltergeist
//

import SwiftUI

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 80, height: 80)

                Image("StatusBarIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                    .foregroundStyle(.tertiary)
            }

            VStack(spacing: 8) {
                Text("No Poltergeist instances found")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.primary)

                Text("Start monitoring a project:")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)

                HStack {
                    Image(systemName: "terminal.fill")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)

                    Text("poltergeist haunt")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.primary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.regularMaterial)
                .cornerRadius(8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}
