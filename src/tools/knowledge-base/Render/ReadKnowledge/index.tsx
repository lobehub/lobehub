'use client';

import { ReadKnowledge as BaseReadKnowledge } from '@lobechat/builtin-tool-knowledge-base/client';
import { type BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import FileIcon from '@/components/FileIcon';

import type { ReadKnowledgeArgs, ReadKnowledgeState } from '../../index';

const ReadKnowledge = memo<BuiltinRenderProps<ReadKnowledgeArgs, ReadKnowledgeState>>(
  ({ pluginState }) => {
    const { t } = useTranslation('tool');

    return (
      <BaseReadKnowledge
        FileIcon={FileIcon}
        labels={{
          chars: t('lobe-knowledge-base.readKnowledge.meta.chars'),
          lines: t('lobe-knowledge-base.readKnowledge.meta.lines'),
        }}
        pluginState={pluginState}
      />
    );
  },
);

export default ReadKnowledge;
