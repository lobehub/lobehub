import { A2uiManifest } from '@lobechat/builtin-tool-a2ui';
import { A2uiExecutionRuntime } from '@lobechat/builtin-tool-a2ui/executionRuntime';

import { type ServerRuntimeRegistration } from './types';

/** Validates a card on the server; stateless, so one instance serves every request. */
const runtime = new A2uiExecutionRuntime();

export const a2uiRuntime: ServerRuntimeRegistration = {
  factory: () => runtime,
  identifier: A2uiManifest.identifier,
};
