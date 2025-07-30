# Testing Architecture

This document describes the testing approach, patterns, and best practices for the Poltergeist project.

## Overview

The Poltergeist project uses Vitest as its testing framework and follows a dependency injection pattern to ensure high testability and maintainability.

## Key Principles

1. **Dependency Injection**: All external dependencies are injected, making components easily testable
2. **Interface Segregation**: Components depend on interfaces, not concrete implementations
3. **Test Isolation**: Each test is completely isolated from others
4. **Mock Factories**: Reusable mock factories reduce test setup boilerplate

## Test Structure

### Unit Tests
- Located alongside source files (e.g., `watchman.test.ts` tests `watchman.ts`)
- Focus on testing individual components in isolation
- Use mocked dependencies

### Integration Tests
- Located in `test/` directory with descriptive names
- Test multiple components working together
- Use a mix of real and mocked dependencies

## Dependency Injection Pattern

The project uses constructor-based dependency injection:

```typescript
// Production code
const poltergeist = new Poltergeist(config, projectRoot, logger);

// Test code with injected dependencies
const poltergeist = createPoltergeistWithDeps(
  config, 
  projectRoot, 
  mockDependencies, 
  logger
);
```

## Test Helpers

### Factory Functions (`src/factories.ts`)

- `createPoltergeist()` - Creates instance with default dependencies
- `createPoltergeistWithDeps()` - Creates instance with custom dependencies
- `createMockDependencies()` - Creates a complete set of mock dependencies

### Test Helpers (`test/helpers.ts`)

- `createTestHarness()` - Sets up complete test environment
- `createMockLogger()` - Creates a mock logger with vi.fn() spies
- `createMockWatchmanClient()` - Creates a mock Watchman client with EventEmitter
- `simulateFileChange()` - Simulates file changes through Watchman
- `waitForAsync()` - Waits for timers and promises to resolve
- `expectBuilderCalledWith()` - Asserts builder was called with expected files

## Common Testing Patterns

### 1. Setting Up a Test Harness

```typescript
describe('Feature Test', () => {
  let poltergeist: Poltergeist;
  let harness: TestHarness;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    
    harness = createTestHarness({
      targets: [/* your test targets */]
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
```

### 2. Simulating File Changes

```typescript
it('should rebuild when files change', async () => {
  poltergeist = createPoltergeistWithDeps(
    harness.config, 
    '/test/project', 
    harness.deps, 
    harness.logger
  );
  await poltergeist.start();

  // Simulate file change
  simulateFileChange(harness.watchmanClient, ['src/index.ts']);
  
  // Wait for debounce/settling delay
  await waitForAsync(110);
  
  // Assert build was triggered
  const builder = harness.builderFactory.builders.get('my-target');
  expect(builder?.build).toHaveBeenCalledWith(['src/index.ts']);
});
```

### 3. Testing Error Scenarios

```typescript
it('should handle build failures gracefully', async () => {
  // Make build fail
  const builder = harness.builderFactory.builders.get('my-target');
  vi.mocked(builder!.build).mockResolvedValue({
    status: 'failure',
    targetName: 'my-target',
    timestamp: new Date().toISOString(),
    error: 'Build failed',
  });

  // Trigger build and verify error handling
  simulateFileChange(harness.watchmanClient, ['src/index.ts']);
  await waitForAsync(110);
  
  expect(harness.logger.error).toHaveBeenCalled();
});
```

### 4. Testing with Multiple Targets

```typescript
const harness = createTestHarness({
  targets: [
    {
      name: 'backend',
      type: 'executable',
      enabled: true,
      buildCommand: 'npm run build:backend',
      outputPath: './dist/backend',
      watchPaths: ['backend/**/*.ts'],
    },
    {
      name: 'frontend',
      type: 'executable',
      enabled: true,
      buildCommand: 'npm run build:frontend',
      outputPath: './dist/frontend',
      watchPaths: ['frontend/**/*.tsx'],
    },
  ],
});
```

## Mock Behavior Conventions

### StateManager Mock
- `initializeState()` - Returns a valid state object
- `readState()` - Returns null by default (no existing state)
- `isLocked()` - Returns false by default

### WatchmanClient Mock
- Extends EventEmitter for event simulation
- `connect()` - Resolves immediately
- `subscribe()` - Stores callbacks for file change simulation
- `isConnected()` - Returns true by default

### BuilderFactory Mock
- Tracks created builders in a Map
- Each builder has standard mock methods
- Builders return success by default

## Best Practices

1. **Always clear mocks between tests**
   ```typescript
   beforeEach(() => {
     vi.clearAllMocks();
   });
   ```

2. **Use fake timers for deterministic tests**
   ```typescript
   beforeEach(() => {
     vi.useFakeTimers();
   });
   afterEach(() => {
     vi.useRealTimers();
   });
   ```

3. **Test both success and failure paths**

4. **Use descriptive test names that explain the scenario**

5. **Keep tests focused - test one behavior per test**

6. **Use test helpers to reduce boilerplate**

7. **Mock at the appropriate level - prefer high-level mocks**

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test watchman.test.ts

# Run with coverage
npm run test:coverage
```

## Debugging Tests

1. Use `console.log` for quick debugging
2. Use `vi.spyOn` to spy on real implementations
3. Check mock call arguments: `vi.mocked(fn).mock.calls`
4. Use `test.only` to focus on a single test
5. Increase test timeout for debugging: `test('name', { timeout: 10000 }, ...)`