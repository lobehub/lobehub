import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AlertTriangle, CornerUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { resolveRejectedCopyKey } from './resolveRejectedCopyKey';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    padding-block: 8px;
    padding-inline: 6px;
  `,
  reason: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    font-size: 14px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface RejectedResponseProps {
  /** Distinguishes question skips from other skipped interactions in the copy. */
  apiName?: string;
  reason?: string;
  /**
   * The user skipped the interaction (e.g. an AskUserQuestion) instead of
   * rejecting the tool call — render a neutral note, not a warning.
   */
  skipped?: boolean;
}

const RejectedResponse = memo<RejectedResponseProps>(({ apiName, reason, skipped }) => {
  const { t } = useTranslation('chat');

  const copyKey = resolveRejectedCopyKey({ apiName, reason, skipped });

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} gap={8}>
        {skipped ? (
          <Icon color={cssVar.colorTextTertiary} icon={CornerUpRight} size={16} />
        ) : (
          <Icon color={cssVar.colorWarning} icon={AlertTriangle} size={16} />
        )}
        <div className={styles.title}>{t(copyKey, { reason })}</div>
      </Flexbox>
    </Flexbox>
  );
});

export default RejectedResponse;
