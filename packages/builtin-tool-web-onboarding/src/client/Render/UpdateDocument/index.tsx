'use client';

import type { MarkdownPatchHunk } from '@lobechat/markdown-patch';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { UpdateDocumentArgs, WebOnboardingDocumentType } from '../../../types';
import HunkBlock from './HunkBlock';

interface UpdateDocumentState {
  applied?: number;
  id?: string;
  type?: WebOnboardingDocumentType;
}

export type UpdateDocumentRenderProps = Pick<
  BuiltinRenderProps<UpdateDocumentArgs, UpdateDocumentState>,
  'args'
>;

const UpdateDocument = memo<UpdateDocumentRenderProps>(({ args }) => {
  const { t } = useTranslation('plugin');
  const hunks: MarkdownPatchHunk[] = args?.hunks ?? [];

  if (hunks.length === 0) return null;

  const totalLabel = t('builtins.lobe-web-onboarding.inspector.hunkCount', {
    count: hunks.length,
  });

  return (
    <Flexbox gap={12}>
      {hunks.map((hunk, i) => (
        <HunkBlock countLabel={i === 0 ? totalLabel : undefined} hunk={hunk} key={i} />
      ))}
    </Flexbox>
  );
});

export default UpdateDocument;
