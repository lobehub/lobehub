import { AsyncLocalStorage } from 'node:async_hooks';
import { setTimeout as delay } from 'node:timers/promises';

interface DeviceOperation {
  cancelling?: Promise<boolean>;
  closed: boolean;
  pending: number;
  resources: Set<() => Promise<boolean>>;
}

interface ToolResult {
  content: string;
  error?: unknown;
  state?: unknown;
  success: boolean;
}

interface LifecycleResult {
  content: string;
  error?: never;
  state?: { exited?: boolean; registered?: boolean };
  success: boolean;
}

const operations = new Map<string, DeviceOperation>();
const currentOperation = new AsyncLocalStorage<DeviceOperation>();

/** Register before observing a shell, including commands that return in the background. */
export function registerDeviceOperationResource(terminate: () => Promise<boolean>) {
  currentOperation.getStore()?.resources.add(terminate);
}

const drain = async (operation: DeviceOperation): Promise<boolean> => {
  operation.closed = true;
  const deadline = Date.now() + 8000;
  do {
    const resources = [...operation.resources];
    const results = await Promise.allSettled(resources.map((terminate) => terminate()));
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value)
        operation.resources.delete(resources[index]);
      else if (result.status === 'rejected')
        console.error('[device-operation] Could not terminate a resource:', result.reason);
    });
    // A tool already in flight may still spawn/register a shell. Check both after draining.
    if (!operation.pending && !operation.resources.size) return true;
    await delay(50);
  } while (Date.now() < deadline);
  return false;
};

/**
 * Internal device lifecycle RPCs. Channel explicitly begins a scope before dispatching
 * Native execution; ordinary chat calls remain unchanged. A lost/restarted scope cannot
 * confirm exit. Closed scopes fence delayed RPCs for the lifetime of this device process.
 */
export async function executeDeviceOperation<T extends ToolResult>(
  { apiName, operationId }: { apiName: string; operationId?: string },
  execute: () => Promise<T>,
): Promise<T | LifecycleResult> {
  const lifecycle = apiName === 'beginNativeOperation' || apiName === 'cancelNativeOperation';
  if (lifecycle && !operationId)
    return { content: 'Operation identity is required', success: false };
  let operation = operationId ? operations.get(operationId) : undefined;
  if (apiName === 'beginNativeOperation' && process.platform === 'win32')
    // Windows cannot prove that a naturally exited command left no descendants, so a scope
    // could never confirm exit and would hold its directory forever. Refuse before any run.
    return {
      content: 'Native Channel execution is not supported on Windows devices yet',
      state: { registered: false },
      success: false,
    };
  if (apiName === 'beginNativeOperation' && operationId) {
    if (!operation) {
      operation = { closed: false, pending: 0, resources: new Set() };
      operations.set(operationId, operation);
    }
    return { content: '', state: { registered: !operation.closed }, success: !operation.closed };
  }
  if (apiName === 'cancelNativeOperation') {
    if (!operation)
      return { content: 'Operation is not registered in this device process', success: false };
    operation.cancelling ??= drain(operation);
    const exited = await operation.cancelling;
    if (!exited) operation.cancelling = undefined;
    return { content: '', state: { exited }, success: exited };
  }
  if (!operation) return execute();
  if (operation.closed)
    return { content: 'Operation has ended; delayed tool call was rejected', success: false };
  const scope = operation;
  scope.pending++;
  try {
    return await currentOperation.run(scope, execute);
  } finally {
    scope.pending--;
  }
}
