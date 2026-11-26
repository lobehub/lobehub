import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { surfaceToText, validateSurface } from '@lobehub/a2ui';

import type { RenderUIParams, RenderUIState } from '../types';

/**
 * Validates and stores a card. Runs wherever the tool runs; nothing here renders. The state carries
 * the surface for the Render and for a Channel reply; the content tells the model what it drew, or
 * what to fix.
 */
export class A2uiExecutionRuntime {
  async renderUI(params: RenderUIParams): Promise<BuiltinServerRuntimeOutput> {
    const result = validateSurface(params?.operations);
    if (!result.ok) {
      const message = `The card was not drawn. Fix these and call renderUI again:\n- ${result.errors.join('\n- ')}`;
      return {
        content: message,
        error: { body: { errors: result.errors }, message, type: 'InvalidSurface' },
        success: false,
      };
    }
    const state: RenderUIState = { surface: result.record };
    return {
      content: `Card drawn and shown to the user: ${surfaceToText(result.record, { max: 300 }) || result.record.surfaceId}. Do not repeat its content in text.`,
      state,
      success: true,
    };
  }
}
