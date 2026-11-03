# Electron IPC Testing Strategy

For Electron IPC tests, use **Mock return values** instead of real Electron environment.

## Basic Mock Setup

```typescript
import { vi } from 'vitest';
import { electronIpcClient } from '@/server/modules/ElectronIPCClient';

vi.mock('@/server/modules/ElectronIPCClient', () => ({
  electronIpcClient: {
    getFilePathById: vi.fn(),
    deleteFiles: vi.fn(),
  },
}));
```

## Setting Mock Behavior

```typescript
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(electronIpcClient.getFilePathById).mockResolvedValue('/path/to/file.txt');
  vi.mocked(electronIpcClient.deleteFiles).mockResolvedValue({ success: true });
});
```

## Testing Different Scenarios

```typescript
it('should handle successful file deletion', async () => {
  vi.mocked(electronIpcClient.deleteFiles).mockResolvedValue({ success: true });

  const result = await service.deleteFiles(['desktop://file1.txt']);

  expect(electronIpcClient.deleteFiles).toHaveBeenCalledWith(['desktop://file1.txt']);
  expect(result.success).toBe(true);
});

it('should handle file deletion failure', async () => {
  vi.mocked(electronIpcClient.deleteFiles).mockRejectedValue(new Error('Delete failed'));

  const result = await service.deleteFiles(['desktop://file1.txt']);

  expect(result.success).toBe(false);
  expect(result.errors).toBeDefined();
});
```

## Advantages

1. **Environment simplification**: No complex Electron setup
2. **Controlled testing**: Precise control over IPC return values
3. **Scenario coverage**: Easy to test success/failure cases
4. **Speed**: Mock calls are faster than real IPC

## Notes

- Ensure mock behavior matches real IPC interface
- Use `vi.mocked()` for type safety
- Reset mocks in `beforeEach` to avoid test interference
- Verify both return values and that IPC methods were called correctly
