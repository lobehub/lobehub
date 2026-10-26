'use client';

import { cssVar, Flexbox, Text } from '@lobehub/ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FeishuQuickCreate, { type FeishuCreatedApp } from './FeishuQuickCreate';
import { getSetupGuide } from './guides';
import { toRegistrationName } from './links';
import SetupGuide from './SetupGuide';

interface QuickSetupSectionProps {
  /** Name the created app / Slack manifest starts with (the agent's name). */
  appName: string;
  disabled?: boolean;
  // Only reads `applicationId`; any channel form shape works.
  form: FormInstance<any>;
  hasConfig?: boolean;
  /** Saves and connects the credentials; resolves `false` when saving failed. */
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => Promise<boolean> | void;
  platformId: string;
  /** Display name of the platform, used in the steps' summary line. */
  platformName: string;
  /** Who the created app is for (the agent id); a new scope starts a new scan. */
  scope?: string;
}

/**
 * Cards above a channel's connection settings: Feishu / Lark create the bot app
 * from one scan (saved and connected through `onAuthenticated`), and every
 * platform gets its setup steps with links straight to the right console page.
 * The steps start open only while there is nothing saved and no scan to use.
 */
const QuickSetupSection = memo<QuickSetupSectionProps>(
  ({ appName, disabled, form, hasConfig, onAuthenticated, platformId, platformName, scope }) => {
    const { t } = useTranslation('agent');
    const applicationId = useWatch(form, (values) => values?.applicationId as string | undefined);
    const guide = useMemo(
      () => getSetupGuide(platformId, { applicationId, appName }),
      [platformId, applicationId, appName],
    );
    if (!guide) return null;

    const canScan = guide.scanToCreate && !hasConfig && !disabled && !!onAuthenticated;

    // Throws when the app can't be saved here, so the scan keeps its credentials.
    const handleCreated = async ({ appId, appSecret, brand }: FeishuCreatedApp) => {
      if (brand !== platformId)
        throw new Error(t(`channel.quickSetup.feishu.scan.brandMismatch.${brand}`));
      const saved = await onAuthenticated?.({ applicationId: appId, credentials: { appSecret } });
      if (saved === false) throw new Error(t('channel.quickSetup.feishu.scan.saveFailed'));
    };

    return (
      <>
        {canScan && (
          <Form.Group collapsible={false} variant={'filled'}>
            <Flexbox gap={12} style={{ paddingBlock: 16 }}>
              {/* Keyed so another agent or platform never inherits this scan. */}
              <FeishuQuickCreate
                appPreset={{ name: toRegistrationName(appName) }}
                key={`${scope ?? ''}:${platformId}`}
                platform={platformId as 'feishu' | 'lark'}
                scope={scope}
                onCreated={handleCreated}
              />
              <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
                {t('channel.quickSetup.manualToggle')}
              </Text>
            </Flexbox>
          </Form.Group>
        )}
        <Form.Group
          collapsible
          defaultActive={!hasConfig && !guide.scanToCreate}
          desc={t('channel.quickSetup.guideDesc', { name: platformName })}
          keyValue={`setup-guide-${platformId}`}
          title={t('channel.quickSetup.guideTitle')}
          variant={'filled'}
        >
          <div style={{ paddingBlock: 16 }}>
            <SetupGuide guide={guide} />
          </div>
        </Form.Group>
      </>
    );
  },
);

QuickSetupSection.displayName = 'ChannelQuickSetupSection';

export default QuickSetupSection;
