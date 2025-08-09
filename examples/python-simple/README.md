# Python Simple Example

A simple Python example for Poltergeist that demonstrates file watching and automatic test execution without requiring external dependencies.

## Features

- **Calculator Module**: Basic arithmetic operations
- **Statistics Module**: Simple statistical calculations
- **Unit Tests**: Comprehensive test coverage using Python's built-in unittest
- **No External Dependencies**: Uses only Python standard library

## Structure

```
python-simple/
├── src/
│   ├── __init__.py
│   ├── calculator.py    # Basic math operations
│   ├── statistics.py    # Statistical calculations
│   └── main.py         # Entry point
├── tests/
│   ├── test_calculator.py
│   └── test_statistics.py
└── poltergeist.config.json
```

## Usage

Start Poltergeist to watch for changes:
```bash
poltergeist haunt
```

Run tests manually:
```bash
python -m unittest discover -s tests -p '*.py' -v
```

Run the main program:
```bash
python src/main.py
```

## Testing

Any changes to Python files will automatically trigger test execution. The test results are written to `test-results.txt`.

This example demonstrates:
- Automatic test execution on file changes
- Python project structure
- Unit testing without external dependencies
- File watching with customized paths