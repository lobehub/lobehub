import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { AlertTriangle, CornerUpRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

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

/**
 * All ask surfaces (user-interaction, lobe-agent, claude-code) share this
 * apiName; other skippable interactions (e.g. the onboarding marketplace
 * picker) get the generic skipped copy instead of the question-specific one.
 */
const ASK_USER_QUESTION_API_NAME = 'askUserQuestion';

const RejectedResponse = memo<RejectedResponseProps>(({ apiName, reason, skipped }) => {
  const { t } = useTranslation('chat');

  if (skipped)
    return (
      <Flexbox className={styles.container} gap={8}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorTextTertiary} icon={CornerUpRight} size={16} />
          <div className={styles.title}>
            {apiName === ASK_USER_QUESTION_API_NAME
              ? t('tool.intervention.questionSkipped')
              : t('tool.intervention.toolSkipped')}
          </div>
        </Flexbox>
      </Flexbox>
    );

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox horizontal align={'center'} gap={8}>
        <Icon color={cssVar.colorWarning} icon={AlertTriangle} size={16} />
        <div className={styles.title}>
          {reason
            ? t('tool.intervention.rejectedWithReason', { reason })
            : t('tool.intervention.toolRejected')}
        </div>
      </Flexbox>
    </Flexbox>
  );
});

export default RejectedResponse;
