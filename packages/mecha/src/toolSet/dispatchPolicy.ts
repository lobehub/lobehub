import { chatModeAllowedToolIds, getUserDisabledToolIds } from '@lobechat/builtin-tools';
import type { LobeToolManifest } from '@lobechat/context-engine';
import type {
  AgentPluginEntry,
  ContextReplayExecutionBinding,
  ConversationMode,
  LobeAgentChatConfig,
} from '@lobechat/types';
import {
  getOptedInPluginIds,
  manifestBaseIdentifier,
  resolveToolMode,
  withConversationMode,
} from '@lobechat/types';

import { isDeviceToolIdentifier } from './deviceTools';

export const assertToolDispatchPolicy = (input: {
  apiName: string;
  chatConfig?: LobeAgentChatConfig | null;
  conversationMode?: ConversationMode;
  currentDeviceId?: string;
  currentBinding?: ContextReplayExecutionBinding;
  expectedBinding?: ContextReplayExecutionBinding;
  expectedDeviceId?: string;
  executionTarget?: 'auto' | 'local' | 'device' | 'sandbox' | 'none';
  identifier: string;
  manifest?: LobeToolManifest;
  plugins?: AgentPluginEntry[];
}) => {
  if (
    input.executionTarget === 'none' &&
    (isDeviceToolIdentifier(input.identifier) ||
      input.identifier === 'lobe-cloud-sandbox' ||
      input.identifier === 'lobe-skills')
  )
    throw new Error('Execution environment is no longer enabled');
  const config = withConversationMode(input.chatConfig ?? {}, input.conversationMode);
  const mode = resolveToolMode(config);
  const baseId = manifestBaseIdentifier(input.manifest ?? { identifier: input.identifier });
  const denied = getUserDisabledToolIds(input.plugins, config);
  if (denied.includes(input.identifier) || denied.includes(baseId))
    throw new Error('Tool is no longer enabled');
  if (mode === 'chat' && !chatModeAllowedToolIds.includes(baseId))
    throw new Error('Tool is unavailable in this conversation mode');
  if (
    mode === 'custom' &&
    !getOptedInPluginIds(input.plugins).some((id) => id === baseId || id === input.identifier)
  )
    throw new Error('Tool is outside the custom tool set');
  if (input.manifest && !input.manifest.api.some((api) => api.name === input.apiName))
    throw new Error('Tool API is no longer available');
  const deviceDependent =
    isDeviceToolIdentifier(input.identifier) ||
    (input.identifier === 'lobe-skills' &&
      ['execScript', 'runCommand', 'exportFile'].includes(input.apiName) &&
      !!input.expectedDeviceId);
  if (
    deviceDependent &&
    input.expectedBinding &&
    input.currentBinding &&
    (input.expectedBinding.topicDeviceId !== input.currentBinding.topicDeviceId ||
      input.expectedBinding.agentDeviceId !== input.currentBinding.agentDeviceId)
  )
    throw new Error('Execution device binding changed; start a new call');
  if (deviceDependent && input.currentDeviceId && input.currentDeviceId !== input.expectedDeviceId)
    throw new Error('Execution device changed; start a new call for the selected device');
};
