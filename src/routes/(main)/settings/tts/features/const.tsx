import { OpenAI } from '@lobehub/icons';
import { type SelectProps } from '@lobehub/ui';

import { LabelRenderer } from '@/components/ModelSelect';

export const opeanaiTTSOptions: SelectProps['options'] = [
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'gpt-4o-mini-tts'} />,
    value: 'gpt-4o-mini-tts',
  },
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'tts-1'} />,
    value: 'tts-1',
  },
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'tts-1-hd'} />,
    value: 'tts-1-hd',
  },
];

export const opeanaiSTTOptions: SelectProps['options'] = [
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'whisper-1'} />,
    value: 'whisper-1',
  },
];

export const sttOptions: SelectProps['options'] = [
  {
    label: 'OpenAI',
    value: 'openai',
  },
  {
    label: 'Browser',
    value: 'browser',
  },
];

export const voiceCallModeOptions: SelectProps['options'] = [
  {
    label: 'Hybrid',
    value: 'hybrid',
  },
  {
    label: 'Browser',
    value: 'browser',
  },
  {
    label: 'Provider native',
    value: 'provider',
  },
];

export const voiceCallProviderOptions: SelectProps['options'] = [
  {
    label: 'Auto',
    value: 'auto',
  },
  {
    label: 'OpenAI Realtime',
    value: 'openai',
  },
  {
    label: 'Gemini Live',
    value: 'gemini',
  },
  {
    label: 'Grok / xAI Voice',
    value: 'xai',
  },
  {
    label: 'OpenRouter Audio',
    value: 'openrouter',
  },
];

export const openAIRealtimeModelOptions: SelectProps['options'] = [
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'gpt-realtime'} />,
    value: 'gpt-realtime',
  },
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'gpt-4o-realtime-preview'} />,
    value: 'gpt-4o-realtime-preview',
  },
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'gpt-4o-mini-realtime-preview'} />,
    value: 'gpt-4o-mini-realtime-preview',
  },
];
