import type { AgentSignalSource } from '@lobechat/agent-signal';

import type { SourceRenderer } from '../types';
import { createBaseSource } from './shared';

export const defaultSourceRenderer = {
  render(input) {
    return {
      ...createBaseSource(input),
      sourceType: input.sourceType,
    } as AgentSignalSource;
  },
  sourceType: '*' as AgentSignalSource['sourceType'],
} satisfies SourceRenderer;
