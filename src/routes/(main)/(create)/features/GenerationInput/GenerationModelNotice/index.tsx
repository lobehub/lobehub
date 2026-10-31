'use client';

import { Alert } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useProviderName } from '@/hooks/useProviderName';

import { type GenerationModelNotice as GenerationModelNoticeType } from './useGenerationModelNotice';

const styles = stylex.create({
  alert: {
    // Keep the icon centered against the single-line title.
    alignItems: 'center',
    flexGrow: '0',
    flexShrink: '1',
    flexBasis: 'auto',
    minWidth: 0,
    maxWidth: { 'default': 'min(560px, 52vw)', '@media (max-width: 768px)': '100%' },
    paddingBlock: '4px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '10px',
    borderRadius: cssVar.borderRadius,
  },
});

interface GenerationModelNoticeProps {
  notice: GenerationModelNoticeType | undefined;
  /** i18n namespace the notice key resolves against. */
  ns: 'image' | 'video';
}

const GenerationModelNotice = memo<GenerationModelNoticeProps>(({ notice, ns }) => {
  const { t } = useTranslation(ns);
  // Hooks must run unconditionally; `useProviderName('')` falls back to the raw id.
  const providerName = useProviderName(notice?.provider ?? '');

  if (!notice) return null;

  return (
    <Alert
      classNames={{ alert: stylex.props(styles.alert).className }}
      style={{ fontSize: 12 }}
      title={t(notice.key, { name: providerName })}
      type={notice.type}
      variant={'borderless'}
    />
  );
});

GenerationModelNotice.displayName = 'GenerationModelNotice';

export default GenerationModelNotice;
