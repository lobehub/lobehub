# Desktop Controller Unit Testing Guide

## Testing Framework & Directory Structure

LobeChat Desktop uses Vitest as the test framework. Controller unit tests should be placed in the `__tests__` directory adjacent to the controller file, named with the original controller filename plus `.test.ts`.

```plaintext
apps/desktop/src/main/controllers/
├── __tests__/
│   ├── index.test.ts
│   ├── MenuCtr.test.ts
│   └── ...
├── McpCtr.ts
├── MenuCtr.ts
└── ...
```

## Basic Test File Structure

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { App } from '@/core/App';

import YourController from '../YourControllerName';

// Mock dependencies
vi.mock('dependency-module', () => ({
  dependencyFunction: vi.fn(),
}));

// Mock App instance
const mockApp = {
  // Mock necessary App properties and methods as needed
} as unknown as App;

describe('YourController', () => {
  let controller: YourController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new YourController(mockApp);
  });

  describe('methodName', () => {
    it('test scenario description', async () => {
      // Prepare test data

      // Execute method under test
      const result = await controller.methodName(params);

      // Verify results
      expect(result).toMatchObject(expectedResult);
    });
  });
});
```

## Mocking External Dependencies

### Module Functions

```typescript
const mockFunction = vi.fn();

vi.mock('module-name', () => ({
  functionName: mockFunction,
}));
```

### Node.js Core Modules

Example: mocking `child_process.exec` and `util.promisify`:

```typescript
const mockExecImpl = vi.fn();

vi.mock('child_process', () => ({
  exec: vi.fn((cmd, callback) => {
    return mockExecImpl(cmd, callback);
  }),
}));

vi.mock('util', () => ({
  promisify: vi.fn((fn) => {
    return async (cmd: string) => {
      return new Promise((resolve, reject) => {
        mockExecImpl(cmd, (error: Error | null, result: any) => {
          if (error) reject(error);
          else resolve(result);
        });
      });
    };
  }),
}));
```

## Best Practices

1. **Isolate tests**: Use `beforeEach` to reset mocks and state
2. **Comprehensive coverage**: Test normal flows, edge cases, and error handling
3. **Clear naming**: Test names should describe content and expected results
4. **Avoid implementation details**: Test behavior, not implementation
5. **Mock external dependencies**: Use `vi.mock()` for all external dependencies

## Example: Testing IPC Event Handler

```typescript
it('should handle IPC event correctly', async () => {
  mockSomething.mockReturnValue({ result: 'success' });

  const result = await controller.ipcMethodName({
    param1: 'value1',
    param2: 'value2',
  });

  expect(result).toEqual({
    success: true,
    data: { result: 'success' },
  });

  expect(mockSomething).toHaveBeenCalledWith('value1', 'value2');
});
```
