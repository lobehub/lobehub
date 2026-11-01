'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddContextMemoryParams, AddContextMemoryState } from '../../../types';
import { ContextMemoryCard } from '../../components';

const AddContextMemoryRender = memo<
  BuiltinRenderProps<AddContextMemoryParams, AddContextMemoryState>
>(({ args }) => {
  return <ContextMemoryCard data={args} />;
});

AddContextMemoryRender.displayName = 'AddContextMemoryRender';

export default AddContextMemoryRender;
