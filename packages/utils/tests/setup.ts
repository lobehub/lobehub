// only inject in the dom environment
if (
  // not node runtime
  typeof globalThis.window !== 'undefined' &&
  // not edge runtime
  typeof (globalThis as any).EdgeRuntime !== 'string'
) {
  // test with canvas
  import('vitest-canvas-mock');
}
