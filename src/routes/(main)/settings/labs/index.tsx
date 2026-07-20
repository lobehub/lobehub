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
    enableMessageTextSelectionActions,
    enableOAuthApps,
    enableInAppBrowser,
    enableArtifactDeployment,
    enableBuiltinTerminal,
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
    labPreferSelectors.enableMessageTextSelectionActions(s),
    labPreferSelectors.enableOAuthApps(s),
    labPreferSelectors.enableInAppBrowser(s),
    labPreferSelectors.enableArtifactDeployment(s),
    labPreferSelectors.enableBuiltinTerminal(s),
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

  const labItems: FormItemProps[] = [
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
    ...(isDesktop
      ? [
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
          } satisfies FormItemProps,
        ]
      : []),
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
    // The in-app browser pages are main-process WebContentsViews — desktop only.
    ...(isDesktop
      ? [
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
          } satisfies FormItemProps,
          // The terminal runs PTY sessions in the Electron main process — desktop only.
          {
            children: (
              <Switch
                checked={enableBuiltinTerminal}
                loading={!isPreferenceInit}
                onChange={(checked: boolean) => updateLab({ enableBuiltinTerminal: checked })}
              />
            ),
            className: styles.labItem,
            desc: tLabs('features.builtinTerminal.desc'),
            label: tLabs('features.builtinTerminal.title'),
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

  const labsGroup: FormGroupItemType = {
    children: labItems,
    title: tLabs('title'),
  };

  return (
    <>
      <SettingHeader title={tLabs('title')} />
      <Form
        collapsible={false}
        items={[labsGroup]}
        itemsType={'group'}
        variant={'filled'}
        {...FORM_STYLE}
      />
    </>
  );
});

export default Page;
