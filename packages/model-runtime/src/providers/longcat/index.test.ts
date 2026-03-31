// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeLongCatAI } from './index';

testProvider({
  Runtime: LobeLongCatAI,
  provider: ModelProvider.LongCat,
  defaultBaseURL: 'https://api.longcat.chat/openai/v1',
  chatDebugEnv: 'DEBUG_LONGCAT_CHAT_COMPLETION',
  chatModel: 'LongCat-Flash-Lite',
});
