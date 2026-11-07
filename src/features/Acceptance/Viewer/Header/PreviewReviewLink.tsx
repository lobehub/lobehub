'use client';

import { createStaticStyles, cssVar, Flexbox, Icon } from '@lobehub/ui';
import { ArrowUpRight, MonitorSmartphone } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import { previewReviewUrl } from './previewReview';

const styles = createStaticStyles(({ css }) => ({
  link: css`
    cursor: pointer;
    color: ${cssVar.colorTextSecondary};

    &:hover {
      color: ${cssVar.colorText};
      text-decoration: underline;
    }
  `,
}));

interface PreviewReviewLinkProps {
  acceptanceId: string;
  rounds: AcceptanceBundle['rounds'];
}

const PreviewReviewLink = memo<PreviewReviewLinkProps>(({ acceptanceId, rounds }) => {
  const { t } = useTranslation('verify');
  const href = previewReviewUrl(acceptanceId, rounds);
  if (!href) return null;
  return (
    <a
      className={styles.link}
      href={href}
      rel={'noreferrer'}
      target={'_blank'}
      title={t('acceptance.preview.reviewHint')}
    >
      <Flexbox horizontal align={'center'} gap={4}>
        <Icon icon={MonitorSmartphone} size={13} />
        {t('acceptance.preview.review')}
        <Icon icon={ArrowUpRight} size={12} />
      </Flexbox>
    </a>
  );
});

PreviewReviewLink.displayName = 'PreviewReviewLink';

export default PreviewReviewLink;
