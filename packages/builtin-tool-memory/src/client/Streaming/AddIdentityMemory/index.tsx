'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddIdentityMemoryParams } from '../../../types';
import { getIdentityMemoryViewModel, IdentityMemoryCard } from '../../components';

export const AddIdentityMemoryStreaming = memo<BuiltinStreamingProps<AddIdentityMemoryParams>>(
  ({ args }) => {
    return <IdentityMemoryCard loading data={getIdentityMemoryViewModel(args)} />;
  },
);

AddIdentityMemoryStreaming.displayName = 'AddIdentityMemoryStreaming';

export default AddIdentityMemoryStreaming;
