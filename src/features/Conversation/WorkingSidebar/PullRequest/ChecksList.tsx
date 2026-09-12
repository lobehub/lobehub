import type { DeviceGitPullRequestCheck } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ExternalLinkIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { electronSystemService } from '@/services/electron/system';

import { OverviewRow } from '../Overview/OverviewRow';
import { formatCheckDuration, getCheckVisual, TONE_COLOR } from './prVisual';

const styles = createStaticStyles(({ css, cssVar }) => ({
  duration: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  list: css`
    padding-inline-start: 18px;
  `,
}));

interface ChecksListProps {
  checks: DeviceGitPullRequestCheck[];
}

const ChecksList = memo<ChecksListProps>(({ checks }) => {
  const { t } = useTranslation('chat');
  const hasRequiredCheck = checks.some((check) => check.required);
  return (
    <div className={styles.list}>
      {checks.map((check, index) => {
        const visual = getCheckVisual(check.status);
        const duration =
          check.status === 'pending' && !check.startedAt
            ? t('workingPanel.pr.check.queued')
            : formatCheckDuration(check);
        return (
          <OverviewRow
            weak
            icon={visual.icon}
            iconColor={TONE_COLOR[visual.tone]}
            key={`${check.name}:${index}`}
            spin={visual.spin}
            title={check.name}
            value={check.name}
            trailing={
              <>
                {hasRequiredCheck && !check.required && (
                  <span>{t('workingPanel.pr.check.optional')}</span>
                )}
                {duration && <span className={styles.duration}>{duration}</span>}
                {check.detailsUrl && <Icon icon={ExternalLinkIcon} size={12} />}
              </>
            }
            onClick={
              check.detailsUrl
                ? () => void electronSystemService.openExternalLink(check.detailsUrl!)
                : undefined
            }
          />
        );
      })}
    </div>
  );
});

ChecksList.displayName = 'PullRequestChecksList';

export default ChecksList;
