'use client';

import { Alert } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useProviderName } from '@/hooks/useProviderName';

import { type GenerationModelNotice as GenerationModelNoticeType } from './useGenerationModelNotice';

const styles = createStaticStyles(({ css, cssVar }) => ({
  alert: css`
    flex: 0 1 auto;

    /* Keep the icon centered against the single-line title. */
    align-items: center !important;

    min-width: 0;
    max-width: min(560px, 52vw);
    padding-block: 4px !important;
    padding-inline: 8px 10px !important;
    border-radius: ${cssVar.borderRadius};

    .ant-alert-content {
      min-width: 0;
    }

    .ant-alert-message,
    .ant-alert-title {
      overflow: hidden;

      font-size: 12px;
      line-height: 18px !important;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ant-alert-icon {
      flex: none;
      height: 18px !important;
      margin-inline-end: 6px !important;
    }

    @media (width <= 768px) {
      max-width: 100%;
    }
  `,
}));

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
      classNames={{ alert: cx(styles.alert) }}
      style={{ fontSize: 12 }}
      title={t(notice.key, { name: providerName })}
      type={notice.type}
      variant={'borderless'}
    />
  );
});

GenerationModelNotice.displayName = 'GenerationModelNotice';

export default GenerationModelNotice;
