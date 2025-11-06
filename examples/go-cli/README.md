# Go CLI Example

This example demonstrates Poltergeist auto-detecting a Go module that uses the common `cmd/<name>/main.go` layout.

The generated configuration should include an enabled `greeter` target with the following properties:

- Build command: `mkdir -p ./dist/bin && go build -o ./dist/bin/greeter ./cmd/greeter`
- Output path: `./dist/bin/greeter`
- Watch paths covering `.go` sources plus `go.mod` / `go.sum`

Running the binary prints **Hello from Go!**. The end-to-end runner touches `internal/messages/messages.go`, waits for Poltergeist to rebuild, and verifies the updated output.
