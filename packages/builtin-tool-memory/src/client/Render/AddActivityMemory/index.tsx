'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddActivityMemoryParams, AddActivityMemoryState } from '../../../types';
import { ActivityMemoryCard } from '../../components';

const AddActivityMemoryRender = memo<
  BuiltinRenderProps<AddActivityMemoryParams, AddActivityMemoryState>
>(({ args }) => {
  return <ActivityMemoryCard data={args} />;
});

AddActivityMemoryRender.displayName = 'AddActivityMemoryRender';

export default AddActivityMemoryRender;
