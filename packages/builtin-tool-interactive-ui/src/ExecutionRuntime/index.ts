import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import { createNativeUIState } from '../native/engine';
import { NativeUIDocumentSchema } from '../native/schema';
import type { RenderUIState } from '../types';

export class InteractiveUIExecutionRuntime {
  async renderUI(args: unknown): Promise<BuiltinServerRuntimeOutput> {
    const result = NativeUIDocumentSchema.safeParse(args);
    if (!result.success) {
      const message =
        'The interactive UI is invalid or exceeds its bounded component/expression limits. Return a complete version-2 native document with valid state and bindings, or answer in plain text.';
      return { content: message, error: { message, type: 'InvalidInteractiveUI' }, success: false };
    }

    const state: RenderUIState = {
      status: 'ready',
      values: createNativeUIState(result.data),
      version: 2,
    };
    return {
      content: `Interactive UI "${result.data.title}" is ready in the conversation. ${result.data.fallback}\nControls run locally. Any proposed follow-up requires the user to press Send in the host. The native document is saved. Declared control values autosave to this conversation; derived values recompute locally.`,
      state,
      success: true,
    };
  }
}
