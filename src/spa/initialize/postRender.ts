type RequestIdleCallback = (callback: () => void, options?: { timeout?: number }) => number;

let postRenderStarted = false;

const scheduleAfterFirstPaint = (task: () => void) => {
  if (typeof window === 'undefined') {
    task();
    return;
  }

  const runWhenIdle = () => {
    const requestIdleCallback = (
      window as typeof window & {
        requestIdleCallback?: RequestIdleCallback;
      }
    ).requestIdleCallback;

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(task, { timeout: 1500 });
      return;
    }

    window.setTimeout(task, 0);
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(runWhenIdle);
    return;
  }

  runWhenIdle();
};

const runConnectorInitialization = async () => {
  const { startConnectorInitialization } = await import('./connectors');
  startConnectorInitialization();
};

const runBuiltinToolExecutorRegistration = async () => {
  const { registerBuiltinToolExecutors } = await import('@/store/tool/slices/builtin/executors');
  await registerBuiltinToolExecutors();
};

export const startPostRenderInitialization = () => {
  if (postRenderStarted) return;
  postRenderStarted = true;

  scheduleAfterFirstPaint(() => {
    void Promise.all([runBuiltinToolExecutorRegistration(), runConnectorInitialization()]).catch(
      (error) => {
        console.error('[SPA Initialize] post-render initialization failed', error);
      },
    );
  });
};
