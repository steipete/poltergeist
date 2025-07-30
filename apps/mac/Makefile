.PHONY: build release clean distribute run test

# Default target
all: build

# Build debug version
build:
	xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist -configuration Debug

# Build release version
release:
	./build.sh Release

# Clean build artifacts
clean:
	xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist clean
	rm -rf build export

# Create distribution DMG
distribute: release
	./distribute.sh

# Run the app
run:
	xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist -configuration Debug run

# Run tests (if any)
test:
	xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist test

# Open in Xcode
open:
	open Poltergeist.xcodeproj

# Install locally (for testing)
install: release
	cp -R build/Poltergeist.xcarchive/Products/Applications/Poltergeist.app /Applications/

# Uninstall
uninstall:
	rm -rf /Applications/Poltergeist.app