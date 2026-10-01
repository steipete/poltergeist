#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <binary-directory> <version>" >&2
  exit 2
fi

binary_dir="$1"
version="$2"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
identity="Developer ID Application: Peter Steinberger (Y5PE65HELJ)"
[[ "${POLTERGEIST_CODESIGN_IDENTITY:-}" == "$identity" ]] || {
  echo "Release packaging requires the personal Developer ID identity" >&2
  exit 1
}

for binary in poltergeist polter; do
  arm64_slice="${binary_dir}/${binary}-arm64"
  x64_slice="${binary_dir}/${binary}-x64"

  for slice in "$arm64_slice" "$x64_slice"; do
    test -x "$slice"
    # Bun ad-hoc-signs compiled slices; cross-compiled signatures can make lipo die during kernel mmap validation.
    codesign --remove-signature "$slice"
    xattr -c "$slice"
  done

  lipo -create "$arm64_slice" "$x64_slice" -output "${binary_dir}/${binary}"
  chmod +x "${binary_dir}/${binary}"
  node "$script_dir/verify-macos-target.mjs" "${binary_dir}/${binary}" 13.0
  codesign --sign "$identity" --force --options runtime --timestamp \
    --entitlements "$script_dir/cli.entitlements.plist" "${binary_dir}/${binary}"
  codesign --verify --strict --all-architectures "${binary_dir}/${binary}"
done

test "$("${binary_dir}/poltergeist" --version)" = "$version"
test "$("${binary_dir}/polter" --version)" = "$version"

archive="poltergeist-macos-universal-v${version}.tar.gz"
bash "$script_dir/notarize-cli.sh" "$binary_dir" "${archive}.notary.json"
tar -C "$binary_dir" -czf "$archive" poltergeist polter
shasum -a 256 "$archive" > "${archive}.sha256"
