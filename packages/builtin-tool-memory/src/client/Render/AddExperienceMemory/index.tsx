'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddExperienceMemoryParams, AddExperienceMemoryState } from '../../../types';
import { ExperienceMemoryCard } from '../../components';

const AddExperienceMemoryRender = memo<
  BuiltinRenderProps<AddExperienceMemoryParams, AddExperienceMemoryState>
>(({ args }) => {
  return <ExperienceMemoryCard data={args} />;
});

AddExperienceMemoryRender.displayName = 'AddExperienceMemoryRender';

export default AddExperienceMemoryRender;
