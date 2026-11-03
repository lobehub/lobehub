'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddIdentityMemoryParams, AddIdentityMemoryState } from '../../../types';
import { getIdentityMemoryViewModel, IdentityMemoryCard } from '../../components';

const AddIdentityMemoryRender = memo<
  BuiltinRenderProps<AddIdentityMemoryParams, AddIdentityMemoryState>
>(({ args }) => {
  return <IdentityMemoryCard data={getIdentityMemoryViewModel(args)} />;
});

AddIdentityMemoryRender.displayName = 'AddIdentityMemoryRender';

export default AddIdentityMemoryRender;
