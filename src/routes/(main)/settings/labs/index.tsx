'use client';

import { isDesktop } from '@lobechat/const';
import { type FormGroupItemType, type FormItemProps } from '@lobehub/ui';
import { Form, Skeleton } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { FORM_STYLE } from '@/const/layoutTokens';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { labPreferSelectors, preferenceSelectors } from '@/store/user/selectors';

const styles = createStaticStyles(({ css }) => ({
  labItem: css`
    .ant-form-item-row {
      align-items: center !important;
    }
  `,
}));

const Page = memo(() => {
  const { t: tLabs } = useTranslation('labs');

  const [
    isPreferenceInit,
    isUserStateInit,
    isUserStateInitError,
    refreshUserState,
    enableAgentGraphConfig,
    enableInputMarkdown,
    enablePlatformAgent,
    enableImessage,
    enableClaudeCodeSdk,
    enableHeteroSessionImport,
    enableMessageTextSelectionActions,
    enableOAuthApps,
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
    labPreferSelectors.enablePlatformAgent(s),
    labPreferSelectors.enableImessage(s),
    labPreferSelectors.enableClaudeCodeSdk(s),
    labPreferSelectors.enableHeteroSessionImport(s),
    labPreferSelectors.enableMessageTextSelectionActions(s),
    labPreferSelectors.enableOAuthApps(s),
    labPreferSelectors.enableInAppBrowser(s),
    labPreferSelectors.enableArtifactDeployment(s),
    labPreferSelectors.enableTopicAcceptance(s),
    s.updateLab,
  ]);

  const hasGatewayUrl = useServerConfigStore((s) => !!s.serverConfig.agentGatewayUrl);

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

  // Cross-surface experiments. Platform-specific ones (Electron main-process
  // features) live in the Desktop group below; everything else is General.
  const generalItems: FormItemProps[] = [
    {
      children: (
        <Switch
          checked={enableAgentGraphConfig}
          loading={!isPreferenceInit}
          onChange={(checked: boolean) => updateLab({ enableAgentGraphConfig: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.agentGraphConfig.desc'),
      label: tLabs('features.agentGraphConfig.title'),
      minWidth: undefined,
    } satisfies FormItemProps,
    {
      children: (
        <Switch
          checked={enableInputMarkdown}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableInputMarkdown: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.inputMarkdown.desc'),
      label: tLabs('features.inputMarkdown.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableMessageTextSelectionActions}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableMessageTextSelectionActions: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.messageTextSelectionActions.desc'),
      label: tLabs('features.messageTextSelectionActions.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableTopicAcceptance}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableTopicAcceptance: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.topicAcceptance.desc'),
      label: tLabs('features.topicAcceptance.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableOAuthApps}
          loading={!isPreferenceInit}
          onChange={(checked) => updateLab({ enableOAuthApps: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.oauthApps.desc'),
      label: tLabs('features.oauthApps.title'),
      minWidth: undefined,
    },
    ...(hasGatewayUrl
      ? [
          {
            children: (
              <Switch
                checked={enablePlatformAgent}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enablePlatformAgent: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.platformAgent.desc'),
            label: tLabs('features.platformAgent.title'),
            minWidth: undefined,
          } satisfies FormItemProps,
        ]
      : []),
    {
      children: (
        <Switch
          checked={enableArtifactDeployment}
          loading={!isPreferenceInit}
          onChange={(checked: boolean) => updateLab({ enableArtifactDeployment: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.artifactDeployment.desc'),
      label: tLabs('features.artifactDeployment.title'),
      minWidth: undefined,
    } satisfies FormItemProps,
  ];

  // Desktop-only experiments: iMessage bridge, the Claude Code SDK runtime, and
  // the in-app browser (renderer-retained Electron webviews).
  const desktopItems: FormItemProps[] = [
    {
      children: (
        <Switch
          checked={enableImessage}
          loading={!isPreferenceInit}
          onChange={(checked: boolean) => updateLab({ enableImessage: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.imessage.desc'),
      label: tLabs('features.imessage.title'),
      minWidth: undefined,
    } satisfies FormItemProps,
    {
      children: (
        <Switch
          checked={enableClaudeCodeSdk}
          loading={!isPreferenceInit}
          onChange={(checked: boolean) => updateLab({ enableClaudeCodeSdk: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.claudeCodeSdk.desc'),
      label: tLabs('features.claudeCodeSdk.title'),
      minWidth: undefined,
    },
    // rides on the Claude Code hetero-agent stack: scans local CLI
    // transcripts via the Electron main process — desktop only
    {
      children: (
        <Switch
          checked={enableHeteroSessionImport}
          loading={!isPreferenceInit}
          onChange={(checked: boolean) => updateLab({ enableHeteroSessionImport: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.heteroSessionImport.desc'),
      label: tLabs('features.heteroSessionImport.title'),
      minWidth: undefined,
    },
    {
      children: (
        <Switch
          checked={enableInAppBrowser}
          loading={!isPreferenceInit}
          onChange={(checked: boolean) => updateLab({ enableInAppBrowser: checked })}
        />
      ),
      className: styles.labItem,
      desc: tLabs('features.inAppBrowser.desc'),
      label: tLabs('features.inAppBrowser.title'),
      minWidth: undefined,
    },
  ];

  const items: FormGroupItemType[] = [
    {
      children: generalItems,
      title: tLabs('group.general'),
    },
  ];

  // The Desktop group only renders in the Electron shell — all its experiments
  // are main-process features that do not exist on web.
  if (isDesktop) {
    items.push({
      children: desktopItems,
      title: tLabs('group.desktop'),
    });
  }

  return (
    <>
      <SettingHeader description={tLabs('description')} title={tLabs('title')} />
      <Form
        collapsible={false}
        items={items}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    </>
  );
});

export default Page;
