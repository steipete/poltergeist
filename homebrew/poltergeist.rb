class Poltergeist < Formula
  desc "Universal file watcher with auto-rebuild for any language or build system"
  homepage "https://github.com/steipete/poltergeist"
  url "https://github.com/steipete/poltergeist/releases/download/v2.1.8/poltergeist-macos-universal-v2.1.8.tar.gz"
  version "2.1.8"
  sha256 "ea062a83929749acdf59cc6e39505e9da73d7c001057111905c84a7689bfae02"
  license "MIT"

  depends_on "watchman"

  def install
    bin.install "poltergeist"
    bin.install "polter"
  end

  def post_install
    # Ensure binaries are executable
    chmod 0755, bin/"poltergeist"
    chmod 0755, bin/"polter"
  end

  def caveats
    <<~EOS
      Poltergeist has been installed with two commands:
        poltergeist - Main CLI for managing file watching and builds
        polter      - Smart executor for running fresh binaries

      To get started:
        1. Create a poltergeist.config.json in your project
        2. Run 'poltergeist init' to generate a config
        3. Run 'poltergeist start' to begin watching
        4. Use 'polter <target>' to run your binaries

      Watchman is required and has been installed as a dependency.

      Documentation: https://github.com/steipete/poltergeist
    EOS
  end

  test do
    # Test that the binary runs and returns version
    assert_match version.to_s, shell_output("#{bin}/poltergeist --version")

    # Test polter wrapper
    assert_match "Poltergeist", shell_output("#{bin}/polter --help")

    # Check the dependency without starting a daemon outside the test sandbox.
    system Formula["watchman"].opt_bin/"watchman", "--version"
  end
end
