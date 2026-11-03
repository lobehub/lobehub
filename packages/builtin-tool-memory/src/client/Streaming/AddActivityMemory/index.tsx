'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddActivityMemoryParams } from '../../../types';
import { ActivityMemoryCard } from '../../components';

export const AddActivityMemoryStreaming = memo<BuiltinStreamingProps<AddActivityMemoryParams>>(
  ({ args }) => {
    return <ActivityMemoryCard loading data={args} />;
  },
);

AddActivityMemoryStreaming.displayName = 'AddActivityMemoryStreaming';

export default AddActivityMemoryStreaming;
