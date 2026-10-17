'use client';

import { Flexbox } from '@lobehub/ui';
import { Text, toast } from '@lobehub/ui/base-ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/base-ui/form';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import FeishuQuickCreate, { type FeishuCreatedApp } from './FeishuQuickCreate';
import { getSetupGuide } from './guides';
import SetupGuide from './SetupGuide';

// Same quiet group heading as the form's Advanced Settings.
const styles = createStaticStyles(({ css }) => ({
  group: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 0 !important;
  `,
  title: css`
    font-size: 13px;
    font-weight: 400;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface QuickSetupSectionProps {
  /** Name the created app / Slack manifest starts with (the agent's name). */
  appName: string;
  disabled?: boolean;
  // Only reads `applicationId`; any channel form shape works.
  form: FormInstance<any>;
  hasConfig?: boolean;
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => void;
  platformId: string;
}

/**
 * Top of a channel's credential form: Feishu / Lark create the bot app from
 * one scan (saved and connected through `onAuthenticated`), and every platform
 * gets its setup steps with links straight to the right console page.
 */
const QuickSetupSection = memo<QuickSetupSectionProps>(
  ({ appName, disabled, form, hasConfig, onAuthenticated, platformId }) => {
    const { t } = useTranslation('agent');
    const applicationId = useWatch(form, (values) => values?.applicationId as string | undefined);
    const guide = useMemo(
      () => getSetupGuide(platformId, { applicationId, appName }),
      [platformId, applicationId, appName],
    );
    if (!guide) return null;

    const canScan = guide.scanToCreate && !hasConfig && !disabled && !!onAuthenticated;

    const handleCreated = ({ appId, appSecret, brand }: FeishuCreatedApp) => {
      if (brand !== platformId) {
        toast.warning(t(`channel.quickSetup.feishu.scan.brandMismatch.${brand}`));
        return;
      }
      onAuthenticated?.({ applicationId: appId, credentials: { appSecret } });
    };

    return (
      <>
        {canScan && (
          <Flexbox gap={12} style={{ padding: '16px 0' }}>
            <FeishuQuickCreate
              appPreset={{ name: appName }}
              platform={platformId as 'feishu' | 'lark'}
              onCreated={handleCreated}
            />
            <Text fontSize={12} style={{ color: cssVar.colorTextTertiary }}>
              {t('channel.quickSetup.manualToggle')}
            </Text>
          </Flexbox>
        )}
        <Form.Group
          collapsible
          className={styles.group}
          defaultActive={!hasConfig && !guide.scanToCreate}
          keyValue={`setup-guide-${platformId}`}
          variant={'borderless'}
          title={
            <Text as={'span'} className={styles.title}>
              {t('channel.quickSetup.guideTitle')}
            </Text>
          }
        >
          <div style={{ padding: '8px 0 16px' }}>
            <SetupGuide guide={guide} />
          </div>
        </Form.Group>
      </>
    );
  },
);

QuickSetupSection.displayName = 'ChannelQuickSetupSection';

export default QuickSetupSection;
