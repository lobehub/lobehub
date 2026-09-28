import type {
  DeviceGitPullRequestAction,
  DeviceGitPullRequestDetail,
  DeviceGitPullRequestMergeMethod,
} from '@lobechat/types';
import { Button, type DropdownItem, SplitButton } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DockAction, PR_KEYS } from './mergeDockData';
import { MERGE_METHODS } from './mergeMethodStorage';
import type { TranslateKey } from './prVisual';
import type { PullRequestBusy } from './usePullRequestActions';

const tone = (base: string, hover: string) => `
  && > :where(button, a) {
    border-color: ${base};
    background: ${base};
  }

  &&:has(> :where(button, a):hover:not(:disabled, [aria-disabled='true'])) > :where(button, a) {
    border-color: ${hover};
    background: ${hover};
  }
`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  toneError: css`
    ${tone(cssVar.colorError, cssVar.colorErrorHover)}
  `,
  toneSuccess: css`
    ${tone(cssVar.colorSuccess, cssVar.colorSuccessHover)}
  `,
}));

const TONE_CLASS = {
  error: styles.toneError,
  plain: undefined,
  success: styles.toneSuccess,
};

type SplitAction = Extract<DockAction, { kind: 'merge' | 'autoMerge' | 'updateBranch' }>;

const UPDATE_BRANCH_ACTION: SplitAction = { kind: 'updateBranch', tone: 'success' };

interface DockActionButtonProps {
  action: DockAction;
  busy?: PullRequestBusy;
  bypass?: boolean;
  detail: DeviceGitPullRequestDetail;
  onAction: (action: DeviceGitPullRequestAction) => Promise<boolean>;
  onPickMethod: (method: DeviceGitPullRequestMergeMethod) => void;
  onToggleBypass: (bypass: boolean) => void;
  secondary?: boolean;
}

const DockActionButton = memo<DockActionButtonProps>(
  ({ action, busy, bypass, detail, onAction, onPickMethod, onToggleBypass, secondary }) => {
    const { t } = useTranslation('chat');
    const tr = t as unknown as TranslateKey;

    const methodItems: DropdownItem[] = [
      ...MERGE_METHODS.map((item) => ({
        desc: tr(`workingPanel.pr.method.${item}.desc`, { base: detail.baseRefName }),
        key: item,
        label: tr(PR_KEYS.method[item]),
        onClick: () => onPickMethod(item),
      })),
      ...(bypass === undefined
        ? []
        : [
            { type: 'divider' as const },
            {
              checked: bypass,
              danger: true,
              desc: t('workingPanel.pr.hint.bypass'),
              key: 'bypass',
              label: t('workingPanel.pr.bypass'),
              onCheckedChange: onToggleBypass,
              type: 'checkbox' as const,
            },
          ]),
    ];

    const splitButton = (
      split: SplitAction,
      label: string,
      items: DropdownItem[],
      onClick: () => void,
    ) => (
      <SplitButton
        className={secondary ? undefined : TONE_CLASS[split.tone]}
        loading={split.busy}
        size={'small'}
        type={secondary || split.tone === 'plain' ? 'default' : 'primary'}
      >
        <SplitButton.Main onClick={onClick}>
          {split.busy && split.busyLabelKey ? tr(split.busyLabelKey) : label}
        </SplitButton.Main>
        <SplitButton.Menu items={items} placement={'topRight'} />
      </SplitButton>
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
          () =>
            void onAction({
              admin: action.admin,
              headRefOid: detail.headRefOid,
              method: action.method,
              type: 'merge',
            }),
        );
      }
      case 'autoMerge': {
        return splitButton(
          action,
          t('workingPanel.pr.action.autoMerge'),
          methodItems,
          () =>
            void onAction({
              headRefOid: detail.headRefOid,
              method: action.method,
              type: 'autoMerge',
            }),
        );
      }
      case 'updateBranch': {
        return splitButton(
          secondary ? { ...UPDATE_BRANCH_ACTION, busy: busy === 'updateBranch' } : action,
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
          <Button disabled size={'small'} type={'primary'}>
            {tr(action.labelKey)}
          </Button>
        );
      }
    }
  },
);

DockActionButton.displayName = 'PullRequestDockActionButton';

export default DockActionButton;
