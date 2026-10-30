'use client';

import { Button, Flexbox, Icon } from '@lobehub/ui';
import { Form, type FormInstance, useWatch } from '@lobehub/ui/form';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, type ReactNode, useMemo, useState } from 'react';
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
  /** Saves and connects the bot from inside the steps; only offered while setting one up. */
  onSave?: () => void;
  platformId: string;
  /** Input for a credential field, shown under the step that asks for it. */
  renderField?: (key: string) => ReactNode;
  /** A save is running. */
  saving?: boolean;
  /** Who the created app is for (the agent id); a new scope starts a new scan. */
  scope?: string;
}

/**
 * Top of a channel's page: Feishu / Lark create the bot app from one scan
 * (saved and connected through `onAuthenticated`), and every platform gets its
 * setup steps with links straight to the right console page. A saved bot has
 * nothing left to set up, so the section folds away for it.
 */
const QuickSetupSection = memo<QuickSetupSectionProps>(
  ({
    appName,
    disabled,
    form,
    hasConfig,
    onAuthenticated,
    onSave,
    platformId,
    renderField,
    saving,
    scope,
  }) => {
    const { t } = useTranslation('agent');
    const applicationId = useWatch(form, (values) => values?.applicationId as string | undefined);
    const guide = useMemo(
      () => getSetupGuide(platformId, { applicationId, appName }),
      [platformId, applicationId, appName],
    );
    // Platforms with a scan flow keep the manual steps one click away; the rest
    // have no other way in, so the steps are open from the start.
    const [stepsOpen, setStepsOpen] = useState(false);
    if (!guide) return null;

    const canScan = guide.scanToCreate && !hasConfig && !disabled && !!onAuthenticated;
    const showSteps = !canScan || stepsOpen;

    // Throws when the app can't be saved here, so the scan keeps its credentials.
    const handleCreated = async ({ appId, appSecret, brand }: FeishuCreatedApp) => {
      if (brand !== platformId)
        throw new Error(t(`channel.quickSetup.feishu.scan.brandMismatch.${brand}`));
      const saved = await onAuthenticated?.({ applicationId: appId, credentials: { appSecret } });
      if (saved === false) throw new Error(t('channel.quickSetup.feishu.scan.saveFailed'));
    };

    return (
      <Form.Group
        // A saved bot has nothing left to set up, so the section folds away; a
        // new one keeps it open and has no header to collapse.
        collapsible={!!hasConfig}
        defaultActive={!hasConfig}
        keyValue={`setup-guide-${platformId}`}
        title={t('channel.group.setup')}
        variant={'filled'}
      >
        {canScan && (
          <Flexbox gap={4} style={{ paddingBlock: 16 }}>
            {/* Keyed so another agent or platform never inherits this scan. */}
            <FeishuQuickCreate
              appPreset={{ name: toRegistrationName(appName) }}
              key={`${scope ?? ''}:${platformId}`}
              platform={platformId as 'feishu' | 'lark'}
              scope={scope}
              onCreated={handleCreated}
            />
            <Button
              icon={<Icon icon={stepsOpen ? ChevronDown : ChevronRight} />}
              size={'small'}
              style={{ alignSelf: 'flex-start', marginBlockStart: 8 }}
              type={'text'}
              onClick={() => setStepsOpen((open) => !open)}
            >
              {t('channel.quickSetup.manualToggle')}
            </Button>
          </Flexbox>
        )}
        {showSteps && (
          <SetupGuide
            guide={guide}
            renderField={renderField}
            connectStep={
              onSave && !hasConfig
                ? {
                    action: (
                      <Button
                        disabled={disabled}
                        loading={saving}
                        style={{ flexShrink: 0 }}
                        type={'primary'}
                        onClick={onSave}
                      >
                        {t('channel.saveAndConnect')}
                      </Button>
                    ),
                    desc: t('channel.quickSetup.connect.desc'),
                    title: t('channel.quickSetup.connect.title'),
                  }
                : undefined
            }
          />
        )}
      </Form.Group>
    );
  },
);

QuickSetupSection.displayName = 'ChannelQuickSetupSection';

export default QuickSetupSection;
