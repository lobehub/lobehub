import { Azure, OpenAI } from '@lobehub/icons';
import { type SelectProps } from '@lobehub/ui';

import { LabelRenderer } from '@/components/ModelSelect';

export const ttsOptions: SelectProps['options'] = [
  {
    label: <LabelRenderer Icon={OpenAI.Avatar} label={'OpenAI'} />,
    value: 'openai',
  },
  {
    label: <LabelRenderer Icon={Azure.Avatar} label={'Edge Speech'} />,
    value: 'edge',
  },
  {
    label: <LabelRenderer Icon={Azure.Avatar} label={'Microsoft Speech'} />,
    value: 'microsoft',
  },
];
