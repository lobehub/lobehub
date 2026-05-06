'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebOnboardingDocumentType } from '../../../types';
import DocumentCard from './DocumentCard';

interface WriteDocumentArgs {
  content?: string;
  type?: WebOnboardingDocumentType;
}

export type WriteDocumentRenderProps = Pick<
  BuiltinRenderProps<WriteDocumentArgs, { id?: string; type?: WebOnboardingDocumentType }>,
  'args'
>;

const WriteDocument = memo<WriteDocumentRenderProps>(({ args }) => {
  const { t } = useTranslation('plugin');
  const content = args?.content;
  const type = args?.type;

  if (!content || !type) return null;

  const title = t(`builtins.lobe-web-onboarding.docType.${type}` as const);

  return <DocumentCard content={content} title={title} />;
});

export default WriteDocument;
