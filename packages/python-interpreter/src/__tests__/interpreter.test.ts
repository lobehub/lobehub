// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A plain function, not an arrow: the interpreter reaches it through `new`.
const stubWorker = () =>
  vi.fn().mockImplementation(function () {
    return {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
      removeEventListener: vi.fn(),
      terminate: vi.fn(),
    };
  });

describe('Python interpreter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('should be undefined if is not in browser', async () => {
    const { getPythonInterpreter } = await import('../index');
    expect(getPythonInterpreter()).toBeUndefined();
  });

  it('should be defined if is in browser', async () => {
    vi.stubGlobal('Worker', stubWorker());

    const { getPythonInterpreter } = await import('../index');
    expect(getPythonInterpreter()).toBeDefined();
  });

  it('does not construct the worker until it is asked for', async () => {
    const Worker = stubWorker();
    vi.stubGlobal('Worker', Worker);

    const { getPythonInterpreter } = await import('../index');
    expect(Worker).not.toHaveBeenCalled();

    getPythonInterpreter();
    expect(Worker).toHaveBeenCalledTimes(1);
  });

  // A cross-origin script URL and a CSP that forbids workers both make the
  // constructor throw. Raised while the module evaluates it would reach every
  // importer and blank the app, so the failure has to stay inside this call.
  it('reports an unavailable interpreter instead of throwing', async () => {
    vi.stubGlobal(
      'Worker',
      vi.fn().mockImplementation(() => {
        throw new DOMException('cannot be accessed from origin', 'SecurityError');
      }),
    );

    const { getPythonInterpreter } = await import('../index');
    expect(() => getPythonInterpreter()).not.toThrow();
    expect(getPythonInterpreter()).toBeUndefined();
  });

  it('constructs the worker once and reuses it', async () => {
    const Worker = stubWorker();
    vi.stubGlobal('Worker', Worker);

    const { getPythonInterpreter } = await import('../index');
    expect(getPythonInterpreter()).toBe(getPythonInterpreter());
    expect(Worker).toHaveBeenCalledTimes(1);
  });
});
