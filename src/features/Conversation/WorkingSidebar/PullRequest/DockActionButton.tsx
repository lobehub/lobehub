import type {
  DeviceGitPullRequestAction,
  DeviceGitPullRequestDetail,
  DeviceGitPullRequestMergeMethod,
} from '@lobechat/types';
import { Flexbox, Icon } from '@lobehub/ui';
import { Button, type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DockAction, PR_KEYS } from './mergeDockData';
import { MERGE_METHODS } from './mergeMethodStorage';
import type { PullRequestBusy } from './usePullRequestActions';

const styles = createStaticStyles(({ css, cssVar }) => ({
  caret: css`
    && {
      margin-inline-start: -1px;
      padding-inline: 4px;
      border-start-start-radius: 0;
      border-end-start-radius: 0;
    }
  `,
  main: css`
    && {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
    }
  `,
  toneError: css`
    && {
      border-color: ${cssVar.colorError};
      background: ${cssVar.colorError};
    }

    &&:hover:not(:disabled) {
      border-color: ${cssVar.colorErrorHover};
      background: ${cssVar.colorErrorHover};
    }
  `,
  toneSuccess: css`
    && {
      border-color: ${cssVar.colorSuccess};
      background: ${cssVar.colorSuccess};
    }

    &&:hover:not(:disabled) {
      border-color: ${cssVar.colorSuccessHover};
      background: ${cssVar.colorSuccessHover};
    }
  `,
  toneWarning: css`
    && {
      border-color: ${cssVar.colorWarning};
      background: ${cssVar.colorWarning};
    }

    &&:hover:not(:disabled) {
      border-color: ${cssVar.colorWarningHover};
      background: ${cssVar.colorWarningHover};
    }
  `,
}));

const TONE_CLASS = {
  error: styles.toneError,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
};

type SplitAction = Extract<DockAction, { kind: 'merge' | 'autoMerge' | 'updateBranch' }>;

interface DockActionButtonProps {
  action: DockAction;
  busy?: PullRequestBusy;
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onPickMethod: (method: DeviceGitPullRequestMergeMethod) => void;
}

const DockActionButton = memo<DockActionButtonProps>(
  ({ action, busy, detail, onAction, onPickMethod }) => {
    const { t } = useTranslation('chat');
    const tr = t as unknown as (key: string, params?: Record<string, string | number>) => string;

    const methodItems: DropdownItem[] = MERGE_METHODS.map((item) => ({
      desc: tr(`workingPanel.pr.method.${item}.desc`, { base: detail.baseRefName }),
      key: item,
      label: tr(PR_KEYS.method[item]),
      onClick: () => onPickMethod(item),
    }));

    const splitButton = (
      split: SplitAction,
      label: string,
      items: DropdownItem[],
      onClick: () => void,
    ) => (
      <Flexbox horizontal>
        <Button
          className={cx(styles.main, TONE_CLASS[split.tone])}
          data-testid={'pr-primary-action'}
          data-tone={split.tone}
          loading={split.busy}
          size={'small'}
          type={'primary'}
          onClick={onClick}
        >
          {split.busy && split.busyLabelKey ? tr(split.busyLabelKey) : label}
        </Button>
        <DropdownMenu items={items} placement={'topRight'}>
          <Button
            className={cx(styles.caret, TONE_CLASS[split.tone])}
            disabled={split.busy}
            icon={<Icon icon={ChevronDownIcon} size={12} />}
            size={'small'}
            type={'primary'}
          />
        </DropdownMenu>
      </Flexbox>
    );

    switch (action.kind) {
      case 'merge': {
        const label = action.admin
          ? `${tr(PR_KEYS.method[action.method])} · ${t('workingPanel.pr.action.bypassSuffix')}`
          : tr(PR_KEYS.method[action.method]);
        return splitButton(
          action,
          label,
          methodItems,
          () => void onAction({ admin: action.admin, method: action.method, type: 'merge' }),
        );
      }
      case 'autoMerge': {
        return splitButton(
          action,
          t('workingPanel.pr.action.autoMerge'),
          methodItems,
          () => void onAction({ method: action.method, type: 'autoMerge' }),
        );
      }
      case 'updateBranch': {
        return splitButton(
          action,
          t('workingPanel.pr.action.updateBranch'),
          [
            {
              key: 'merge',
              label: t('workingPanel.pr.action.updateBranch.merge'),
              onClick: () => void onAction({ method: 'merge', type: 'updateBranch' }),
            },
            {
              key: 'rebase',
              label: t('workingPanel.pr.action.updateBranch.rebase'),
              onClick: () => void onAction({ method: 'rebase', type: 'updateBranch' }),
            },
          ],
          () => void onAction({ method: 'merge', type: 'updateBranch' }),
        );
      }
      case 'ready': {
        return (
          <Button
            data-testid={'pr-primary-action'}
            loading={action.busy}
            size={'small'}
            type={'primary'}
            onClick={() => void onAction({ type: 'ready' })}
          >
            {action.busy && action.busyLabelKey
              ? tr(action.busyLabelKey)
              : t('workingPanel.pr.action.ready')}
          </Button>
        );
      }
      case 'deleteBranch': {
        return (
          <Button
            data-testid={'pr-primary-action'}
            loading={busy === 'deleteBranch'}
            size={'small'}
            onClick={() => void onAction({ head: detail.headRefName, type: 'deleteBranch' })}
          >
            {t('workingPanel.pr.action.deleteBranch')}
          </Button>
        );
      }
      case 'reopen': {
        return (
          <Button
            data-testid={'pr-primary-action'}
            loading={busy === 'reopen'}
            size={'small'}
            onClick={() => void onAction({ type: 'reopen' })}
          >
            {t('workingPanel.pr.action.reopen')}
          </Button>
        );
      }
      case 'disabled': {
        return (
          <Button disabled data-testid={'pr-primary-action'} size={'small'} type={'primary'}>
            {tr(action.labelKey)}
          </Button>
        );
      }
    }
  },
);

DockActionButton.displayName = 'PullRequestDockActionButton';

export default DockActionButton;
