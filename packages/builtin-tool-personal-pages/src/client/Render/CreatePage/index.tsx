'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { CreatePageArgs, CreatePageState } from '../../../types';
import PageCard from './PageCard';

export type CreatePageRenderProps = Pick<
  BuiltinRenderProps<CreatePageArgs, CreatePageState>,
  'args' | 'pluginState'
>;

const CreatePage = memo<CreatePageRenderProps>(({ args, pluginState }) => {
  const title = args?.title;
  const content = args?.content;

  if (!title || !content) return null;

  return <PageCard content={content} pageId={pluginState?.pageId} title={title} />;
});

export default CreatePage;
