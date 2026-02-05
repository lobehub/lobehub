'use client';

import type { BuiltinStreamingProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddExperienceMemoryParams } from '../../../types';
import { ExperienceMemoryCard } from '../../components';

export const AddExperienceMemoryStreaming = memo<BuiltinStreamingProps<AddExperienceMemoryParams>>(
  ({ args }) => {
    return <ExperienceMemoryCard loading data={args} />;
  },
);

AddExperienceMemoryStreaming.displayName = 'AddExperienceMemoryStreaming';

export default AddExperienceMemoryStreaming;
