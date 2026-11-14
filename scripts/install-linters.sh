#!/usr/bin/env bash
set -euo pipefail

# Match the Apple Silicon CI toolchain using checksum-verified archives.
swiftlint_version=0.65.1
swiftlint_sha256=c1e429b0599cf1b516f369a2d9ec04eaf0e436f3c12b637df8851fa52ff694d0
swift_format_version=604.0.0
# Homebrew's dependency-free macOS 15+ arm64 bottle for apple/swift-format.
swift_format_sha256=a4890bc578594b94782ec0e434097a467a1a8e94271b504e0430326a6db55fb2

if [[ "$(uname -s):$(uname -m)" != Darwin:arm64 ]]; then
  echo "Pinned macOS lint tools require Apple Silicon (arm64)." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
bin_dir="${1:-$repo_root/apps/mac/.build/linters}"
mkdir -p "$bin_dir"
download_dir="$(mktemp -d "$bin_dir/downloads.XXXXXX")"
trap 'rm -rf "$download_dir"' EXIT

curl --fail --location --silent --show-error --retry 3 \
  "https://github.com/realm/SwiftLint/releases/download/$swiftlint_version/portable_swiftlint.zip" \
  --output "$download_dir/swiftlint.zip"
# QQ== is Homebrew's fixed public anonymous registry credential, not a secret.
curl --fail --location --silent --show-error --retry 3 \
  --header 'Authorization: Bearer QQ==' \
  "https://ghcr.io/v2/homebrew/core/swift-format/blobs/sha256:$swift_format_sha256" \
  --output "$download_dir/swift-format.tar.gz"

printf '%s  %s\n' "$swiftlint_sha256" "$download_dir/swiftlint.zip" \
  "$swift_format_sha256" "$download_dir/swift-format.tar.gz" | shasum --algorithm 256 --check
unzip -qo "$download_dir/swiftlint.zip" swiftlint -d "$bin_dir"
tar -xzf "$download_dir/swift-format.tar.gz" -C "$download_dir" \
  "swift-format/$swift_format_version/bin/swift-format"
cp "$download_dir/swift-format/$swift_format_version/bin/swift-format" "$bin_dir/swift-format"

"$bin_dir/swiftlint" version
"$bin_dir/swift-format" --version
