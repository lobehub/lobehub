import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CheckCircle2, Circle, CircleAlert, LoaderCircle, XCircle } from 'lucide-react';

import type { VerifyCheckResultItem } from '@/database/schemas/verify';
import { useVerifyResults, useVerifyState } from '@/features/Verify/hooks';
import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';

const styles = createStaticStyles(({ css }) => ({
  badge: css`
    display: inline-flex;
    flex: none;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-size: 12px;
    font-weight: 600;
  `,
}));

const statusMeta = (
  status: VerifyCheckResultItem['status'] | undefined,
): { bg: keyof typeof cssVar; icon: typeof CheckCircle2; text: keyof typeof cssVar } => {
  switch (status) {
    case 'passed': {
      return { bg: 'colorSuccess', icon: CheckCircle2, text: 'colorSuccessTextActive' };
    }
    case 'running': {
      return { bg: 'colorInfo', icon: LoaderCircle, text: 'colorInfoTextActive' };
    }
    case 'failed': {
      return { bg: 'colorError', icon: XCircle, text: 'colorErrorTextActive' };
    }
    case 'skipped': {
      return { bg: 'colorTextQuaternary', icon: CircleAlert, text: 'colorTextSecondary' };
    }
    default: {
      return { bg: 'colorTextQuaternary', icon: Circle, text: 'colorTextSecondary' };
    }
  }
};

const Title = () => {
  const operationId = useChatStore(chatPortalSelectors.verifyResultOperationId);
  const checkItemId = useChatStore(chatPortalSelectors.verifyResultCheckItemId);
  const { data: state } = useVerifyState(operationId ?? null);
  const { data: results } = useVerifyResults(operationId ?? null);

  const item = (state?.verifyPlan ?? []).find((i) => i.id === checkItemId);
  const result = (results ?? []).find((r) => r.checkItemId === checkItemId);

  const sIcon = statusMeta(result?.status);
  const label = result?.verdict ?? result?.status;

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ minWidth: 0 }}>
      <Text className={oneLineEllipsis} style={{ fontSize: 16 }} type={'secondary'}>
        {item?.title}
      </Text>
      {label && (
        <span
          className={styles.badge}
          style={{
            background: `color-mix(in srgb, ${cssVar[sIcon.bg]} 12%, transparent)`,
            color: cssVar[sIcon.text],
          }}
        >
          <Icon icon={sIcon.icon} size={13} spin={result?.status === 'running'} />
          {label}
        </span>
      )}
    </Flexbox>
  );
};

export default Title;
