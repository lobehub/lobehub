'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddContextMemoryParams } from '../../../types';
import { ContextMemoryCard } from '../../components';

export const AddContextMemoryStreaming = memo<BuiltinStreamingProps<AddContextMemoryParams>>(
  ({ args }) => {
    return <ContextMemoryCard loading data={args} />;
  },
);

AddContextMemoryStreaming.displayName = 'AddContextMemoryStreaming';

export default AddContextMemoryStreaming;
