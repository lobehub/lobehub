'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { RemoveIdentityMemoryParams, RemoveIdentityMemoryState } from '../../../types';
import { RemovedIdentityCard } from '../../components';

const RemoveIdentityMemoryRender = memo<
  BuiltinRenderProps<RemoveIdentityMemoryParams, RemoveIdentityMemoryState>
>(({ args }) => {
  return <RemovedIdentityCard data={args} />;
});

RemoveIdentityMemoryRender.displayName = 'RemoveIdentityMemoryRender';

export default RemoveIdentityMemoryRender;
