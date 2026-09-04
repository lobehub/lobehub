// @vitest-environment node
import { ModelProvider } from 'model-bank';

import { testProvider } from '../../providerTestUtils';
import { LobeMetaAI } from './index';

const provider = ModelProvider.Meta;
const defaultBaseURL = 'https://api.meta.ai/v1';

testProvider({
  Runtime: LobeMetaAI,
  provider,
  defaultBaseURL,
  chatDebugEnv: 'DEBUG_META_CHAT_COMPLETION',
  chatModel: 'muse-spark-1.3',
  test: {
    skipAPICall: true,
  },
});
