import type { ModelProviderCard } from '../types';

const FunASR: ModelProviderCard = {
  chatModels: [],
  description:
    'FunASR is an open-source speech recognition toolkit with self-hosted, OpenAI-compatible transcription APIs for SenseVoice, Paraformer, and Fun-ASR-Nano.',
  id: 'funasr',
  modelsUrl: 'https://github.com/modelscope/FunASR/blob/main/docs/model_selection.md',
  name: 'FunASR',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'http://localhost:8000/v1',
    },
    sdkType: 'openai',
    showApiKey: false,
    showChecker: false,
  },
  url: 'https://www.funasr.com',
};

export default FunASR;
