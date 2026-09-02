'use client';

import { Alert } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { UsersRound } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthorInfo } from '@/business/client/hooks/useAuthorInfo';

import { useAcceptanceScope } from './AcceptanceScope';
import { useAcceptanceBundle } from './useAcceptanceBundle';
import { canReviewAcceptance } from './visibility';

/**
 * In-body notice for viewers who reached this acceptance through someone
 * else's shared link or workspace membership: names the author when the
 * business layer can resolve them, and states whether the viewer may review
 * or is read-only — so a page missing its owner controls never looks broken.
 */
const AcceptanceSharedNotice = ({ style }: { style?: CSSProperties }) => {
  const { t } = useTranslation('verify');
  const { acceptanceId } = useAcceptanceScope();
  const { data } = useAcceptanceBundle(acceptanceId);
  const author = useAuthorInfo(data?.acceptance.userId ?? undefined);

  if (!data || data.isOwner) return null;

  return (
    <Alert
      showIcon
      icon={UsersRound}
      style={{ borderRadius: cssVar.borderRadiusLG, ...style }}
      type={'secondary'}
      variant={'outlined'}
      description={t(
        canReviewAcceptance(data)
          ? 'acceptance.sharedNotice.reviewableDescription'
          : 'acceptance.sharedNotice.readOnlyDescription',
      )}
      title={
        author?.fullName
          ? t('acceptance.sharedNotice.titleWithName', { name: author.fullName })
          : t('acceptance.sharedNotice.title')
      }
    />
  );
};

export default AcceptanceSharedNotice;
