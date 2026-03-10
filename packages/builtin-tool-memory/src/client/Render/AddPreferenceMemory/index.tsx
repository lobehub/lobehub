'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddPreferenceMemoryParams, AddPreferenceMemoryState } from '../../../types';
import { PreferenceMemoryCard } from '../../components';

const AddPreferenceMemoryRender = memo<
  BuiltinRenderProps<AddPreferenceMemoryParams, AddPreferenceMemoryState>
>(({ args }) => {
  return <PreferenceMemoryCard data={args} />;
});

AddPreferenceMemoryRender.displayName = 'AddPreferenceMemoryRender';

export default AddPreferenceMemoryRender;
