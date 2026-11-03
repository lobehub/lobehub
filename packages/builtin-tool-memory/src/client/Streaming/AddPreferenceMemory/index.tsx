'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddPreferenceMemoryParams } from '../../../types';
import { PreferenceMemoryCard } from '../../components';

export const AddPreferenceMemoryStreaming = memo<BuiltinStreamingProps<AddPreferenceMemoryParams>>(
  ({ args }) => {
    return <PreferenceMemoryCard loading data={args} />;
  },
);

AddPreferenceMemoryStreaming.displayName = 'AddPreferenceMemoryStreaming';

export default AddPreferenceMemoryStreaming;
