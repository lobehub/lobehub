import type { BuiltinServerRuntimeOutput } from '@lobechat/types';
import { getA2uiProcessor } from '@lobehub/a2ui';

import type { RenderUIParams } from '../types';

/**
 * Validates and stores a card through the `@lobehub/a2ui` processor. Runs wherever the tool runs;
 * nothing here renders. The state carries the surface for the Render and for a Channel reply; the
 * content tells the model what it drew, or what to fix.
 */
export class A2uiExecutionRuntime {
  async renderUI(params: RenderUIParams): Promise<BuiltinServerRuntimeOutput> {
    return getA2uiProcessor().execute(params) as BuiltinServerRuntimeOutput;
  }
}
