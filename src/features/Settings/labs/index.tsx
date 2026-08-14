'use client';

import { isDesktop } from '@lobechat/const';
import { type FormGroupItemType, type FormItemProps } from '@lobehub/ui';
import { Alert, Flexbox, Form, Skeleton, Tag, Tooltip } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { FlaskConicalIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/features/Settings/features/SettingHeader';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';
import { type UserLab } from '@/types/user';

const styles = createStaticStyles(({ css }) => ({
  labItem: css`
    .ant-form-item-row {
      align-items: center !important;
    }
  `,
}));

/**
 * Maturity stage of a lab experiment:
 * - alpha: internal testing only, not recommended for daily use yet
 * - beta: relatively usable — core flow works, details still being polished
 */
type LabStage = 'alpha' | 'beta';

const StageTag = memo<{ stage: LabStage }>(({ stage }) => {
  const { t } = useTranslation('labs');

  return (
    <Tooltip title={t(`stage.${stage}.desc`)}>
      <Tag color={stage === 'alpha' ? 'warning' : 'info'} size={'small'}>
        {t(`stage.${stage}.label`)}
      </Tag>
    </Tooltip>
  );
});

interface LabToggle {
  checked: boolean;
  desc: string;
  flag: keyof UserLab;
  stage: LabStage;
  title: string;
}

const LabsForm = memo(() => {
  const { t: tLabs } = useTranslation('labs');

  const [
    isPreferenceInit,
    isUserStateInit,
    isUserStateInitError,
    refreshUserState,
    enableAgentGraphConfig,
    enableInputMarkdown,
    enableImessage,
    enableClaudeCodeSdk,
    enableCodexAppServer,
    enableDesktopSplitView,
    enableHeteroSessionImport,
    enableMessageTextSelectionActions,
    enableOAuthApps,
    enableProjects,
    enableInAppBrowser,
    enableArtifactDeployment,
    enableTopicAcceptance,
    updateLab,
  ] = useUserStore((s) => [
    preferenceSelectors.isPreferenceInit(s),
    s.isUserStateInit,
    s.isUserStateInitError,
    s.refreshUserState,
    labPreferSelectors.enableAgentGraphConfig(s),
    labPreferSelectors.enableInputMarkdown(s),
    labPreferSelectors.enableImessage(s),
    labPreferSelectors.enableClaudeCodeSdk(s),
    labPreferSelectors.enableCodexAppServer(s),
    labPreferSelectors.enableDesktopSplitView(s),
    labPreferSelectors.enableHeteroSessionImport(s),
    labPreferSelectors.enableMessageTextSelectionActions(s),
    labPreferSelectors.enableOAuthApps(s),
    labPreferSelectors.enableProjects(s),
    labPreferSelectors.enableInAppBrowser(s),
    labPreferSelectors.enableArtifactDeployment(s),
    labPreferSelectors.enableTopicAcceptance(s),
    s.updateLab,
  ]);

  if (!isUserStateInit) {
    // A failed user-state init must show error + Retry, not a permanent skeleton
    if (isUserStateInitError)
      return (
        <AsyncError
          error={isUserStateInitError}
          variant={'block'}
          onRetry={() => refreshUserState()}
        />
      );
    return <Skeleton active paragraph={{ rows: 5 }} title={false} />;
  }

  const toFormItem = ({ checked, desc, flag, stage, title }: LabToggle): FormItemProps => ({
    children: (
      <Switch
        checked={checked}
        loading={!isPreferenceInit}
        onChange={(next: boolean) => updateLab({ [flag]: next })}
      />
    ),
    className: styles.labItem,
    desc,
    label: (
      <Flexbox horizontal align={'center'} gap={8}>
        {title}
        <StageTag stage={stage} />
      </Flexbox>
    ),
    minWidth: undefined,
  });

  // Cross-surface experiments. Platform-specific ones (Electron main-process
  // features) live in the Desktop group below; everything else is General.
  const generalItems: LabToggle[] = [
    {
      checked: enableAgentGraphConfig,
      desc: tLabs('features.agentGraphConfig.desc'),
      flag: 'enableAgentGraphConfig',
      stage: 'alpha',
      title: tLabs('features.agentGraphConfig.title'),
    },
    {
      checked: enableInputMarkdown,
      desc: tLabs('features.inputMarkdown.desc'),
      flag: 'enableInputMarkdown',
      stage: 'beta',
      title: tLabs('features.inputMarkdown.title'),
    },
    {
      checked: enableMessageTextSelectionActions,
      desc: tLabs('features.messageTextSelectionActions.desc'),
      flag: 'enableMessageTextSelectionActions',
      stage: 'alpha',
      title: tLabs('features.messageTextSelectionActions.title'),
    },
    {
      checked: enableTopicAcceptance,
      desc: tLabs('features.topicAcceptance.desc'),
      flag: 'enableTopicAcceptance',
      stage: 'alpha',
      title: tLabs('features.topicAcceptance.title'),
    },
    {
      checked: enableProjects,
      desc: tLabs('features.projects.desc'),
      flag: 'enableProjects',
      stage: 'alpha',
      title: tLabs('features.projects.title'),
    },
    {
      checked: enableOAuthApps,
      desc: tLabs('features.oauthApps.desc'),
      flag: 'enableOAuthApps',
      stage: 'beta',
      title: tLabs('features.oauthApps.title'),
    },
    {
      checked: enableArtifactDeployment,
      desc: tLabs('features.artifactDeployment.desc'),
      flag: 'enableArtifactDeployment',
      stage: 'beta',
      title: tLabs('features.artifactDeployment.title'),
    },
  ];

  // Desktop-only experiments: local agent runtimes, iMessage bridge, and the
  // in-app browser (renderer-retained Electron webviews).
  const desktopItems: LabToggle[] = [
    {
      checked: enableDesktopSplitView,
      desc: tLabs('features.desktopSplitView.desc'),
      flag: 'enableDesktopSplitView',
      stage: 'alpha',
      title: tLabs('features.desktopSplitView.title'),
    },
    {
      checked: enableImessage,
      desc: tLabs('features.imessage.desc'),
      flag: 'enableImessage',
      stage: 'alpha',
      title: tLabs('features.imessage.title'),
    },
    {
      checked: enableClaudeCodeSdk,
      desc: tLabs('features.claudeCodeSdk.desc'),
      flag: 'enableClaudeCodeSdk',
      stage: 'alpha',
      title: tLabs('features.claudeCodeSdk.title'),
    },
    {
      checked: enableCodexAppServer,
      desc: tLabs('features.codexAppServer.desc'),
      flag: 'enableCodexAppServer',
      stage: 'alpha',
      title: tLabs('features.codexAppServer.title'),
    },
    // rides on the Claude Code hetero-agent stack: scans local CLI
    // transcripts via the Electron main process — desktop only
    {
      checked: enableHeteroSessionImport,
      desc: tLabs('features.heteroSessionImport.desc'),
      flag: 'enableHeteroSessionImport',
      stage: 'beta',
      title: tLabs('features.heteroSessionImport.title'),
    },
    {
      checked: enableInAppBrowser,
      desc: tLabs('features.inAppBrowser.desc'),
      flag: 'enableInAppBrowser',
      stage: 'beta',
      title: tLabs('features.inAppBrowser.title'),
    },
  ];

  const items: FormGroupItemType[] = [
    {
      children: generalItems.map((item) => toFormItem(item)),
      title: tLabs('group.general'),
    },
  ];

  // The Desktop group only renders in the Electron shell — all its experiments
  // are main-process features that do not exist on web.
  if (isDesktop) {
    items.push({
      children: desktopItems.map((item) => toFormItem(item)),
      title: tLabs('group.desktop'),
    });
  }

  return (
    <Form
      collapsible={false}
      items={items}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

interface PageProps {
  showSettingHeader?: boolean;
}

const Page = ({ showSettingHeader = true }: PageProps) => {
  const { t: tLabs } = useTranslation('labs');

  return (
    <>
      {showSettingHeader && <SettingHeader title={tLabs('title')} />}
      <Flexbox gap={16}>
        <Alert
          showIcon
          icon={FlaskConicalIcon}
          title={tLabs('description')}
          type={'info'}
          variant={'filled'}
        />
        <LabsForm />
      </Flexbox>
    </>
  );
};

export default Page;
