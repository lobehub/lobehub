import type {
  CodexAppServerClient as NativeCodexAppServerClient,
  CodexThreadSession,
} from '@lobechat/heterogeneous-agents/spawn';
import type { Mock } from 'vitest';

/** Mutable controls shared by the controller's Codex transport scenarios. */
interface CodexAppServerMocks {
  codexAppServerCanReuse: { value: boolean };
  codexAppServerClientCloseMock: Mock;
  codexAppServerClientConstructMock: Mock;
  codexAppServerCloseMock: Mock;
  codexAppServerConstructMock: Mock;
  codexAppServerConsumerCount: { value: number };
  codexAppServerInterruptMock: Mock;
  codexAppServerRunMock: Mock;
  codexAppServerShouldFailAfterThread: { value: boolean };
  codexAppServerShouldFailResume: { value: boolean };
  codexAppServerShouldFallback: { value: boolean };
}

/**
 * Creates the Codex transport doubles while retaining the real client reuse check.
 *
 * Use when:
 * - Controller integration tests need controlled turns without starting a native CLI.
 *
 * Expects:
 * - Each test file registers its own hoisted mock factory and resets its controls.
 *
 * Returns:
 * - Client and session constructors for the spawn module override.
 *
 * Call stack:
 *
 * vi.mock('@lobechat/heterogeneous-agents/spawn')
 *   -> {@link createCodexAppServerMocks}
 *     -> MockCodexThreadSession.run
 */
export function createCodexAppServerMocks(
  actual: { CodexAppServerClient: typeof NativeCodexAppServerClient },
  mocks: CodexAppServerMocks,
): {
  CodexAppServerClient: typeof NativeCodexAppServerClient;
  CodexThreadSession: new (
    options: ConstructorParameters<typeof CodexThreadSession>[0],
  ) => Pick<CodexThreadSession, 'canFallbackToExec' | 'close' | 'interrupt' | 'run'>;
} {
  const {
    codexAppServerCanReuse,
    codexAppServerClientCloseMock,
    codexAppServerClientConstructMock,
    codexAppServerCloseMock,
    codexAppServerConsumerCount,
    codexAppServerConstructMock,
    codexAppServerInterruptMock,
    codexAppServerRunMock,
    codexAppServerShouldFailAfterThread,
    codexAppServerShouldFailResume,
    codexAppServerShouldFallback,
  } = mocks;
  class MockCodexAppServerClient extends actual.CodexAppServerClient {
    constructor(options: ConstructorParameters<typeof NativeCodexAppServerClient>[0]) {
      super(options);
      codexAppServerClientConstructMock(options);
    }

    canReuseFor(options: Parameters<NativeCodexAppServerClient['canReuseFor']>[0]) {
      return codexAppServerCanReuse.value && super.canReuseFor(options);
    }

    get hasConsumers() {
      return codexAppServerConsumerCount.value > 0;
    }

    close() {
      codexAppServerClientCloseMock();
    }
  }

  class MockCodexThreadSession {
    canFallbackToExec = true;
    private closed = false;

    constructor(private readonly options: ConstructorParameters<typeof CodexThreadSession>[0]) {
      codexAppServerConsumerCount.value += 1;
      codexAppServerConstructMock(options);
    }

    close() {
      if (!this.closed) {
        this.closed = true;
        codexAppServerConsumerCount.value -= 1;
      }
      codexAppServerCloseMock();
    }

    async interrupt() {
      return codexAppServerInterruptMock();
    }

    async run(runOptions: Parameters<CodexThreadSession['run']>[0]) {
      await codexAppServerRunMock(runOptions);
      if (codexAppServerShouldFailResume.value && this.options.initialThreadId) {
        this.canFallbackToExec = false;
        const error = new Error('Thread not found');
        error.name = 'CodexAppServerConnectionError';
        throw error;
      }
      if (codexAppServerShouldFallback.value) {
        const error = new Error('Method not found: initialize');
        error.name = 'CodexAppServerConnectionError';
        throw error;
      }

      const now = Date.now();
      this.canFallbackToExec = false;
      if (codexAppServerShouldFailAfterThread.value) {
        const error = new Error('Codex app-server disconnected');
        error.name = 'CodexAppServerConnectionError';
        throw error;
      }
      this.options.onRuntimeStatus?.({
        activeTasks: [],
        lastEventAt: now,
        operationId: runOptions.operationId,
        sessionId: this.options.sessionId,
        state: 'running',
        transport: 'codex-app-server',
      });
      this.options.onSessionId?.('thread_app_server');
      await this.options.onEvents([
        {
          data: { reason: 'complete', transport: 'codex-app-server' },
          operationId: runOptions.operationId,
          stepIndex: 0,
          timestamp: now,
          type: 'agent_runtime_end',
        },
      ]);
      this.options.onRuntimeStatus?.({
        activeTasks: [],
        lastEventAt: now,
        sessionId: this.options.sessionId,
        state: 'closed',
        transport: 'codex-app-server',
      });
    }
  }

  return {
    CodexAppServerClient: MockCodexAppServerClient,
    CodexThreadSession: MockCodexThreadSession,
  };
}
