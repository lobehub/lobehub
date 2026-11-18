'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowUpRight, MonitorSmartphone } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import type { AcceptanceBundle } from '@/services/verify';

import { previewReviewUrl } from './previewReview';

const styles = stylex.create({
  link: {
    cursor: 'pointer',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    textDecoration: { 'default': null, ':hover': 'underline' },
  },
});

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
      {...stylex.props(styles.link)}
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
