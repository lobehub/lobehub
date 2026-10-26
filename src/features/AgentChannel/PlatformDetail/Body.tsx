'use client';

import { Button, confirmModal } from '@lobehub/ui';
import { Form, type FormInstance } from '@lobehub/ui/form';
import { RotateCcw, Trash2 } from 'lucide-react';
import { Fragment, memo, type ReactNode, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  FieldSchema,
  SerializedPlatformDefinition,
} from '@/server/services/bot/platforms/types';
import { useServerConfigStore } from '@/store/serverConfig';

import {
  platformCredentialBodyMap,
  platformCredentialExtrasMap,
  platformSettingsFieldExtrasMap,
} from '../platform/registry';
import QuickSetupSection from '../quickSetup/QuickSetupSection';
import { extractSettingsDefaults } from './formState';
import type { ChannelFormValues } from './index';
import { ApplicationIdField, getFields, SchemaField } from './SchemaField';
import { groupSettingsFields, type SettingsSectionKey } from './sections';
import { ACCOUNT_SECTION_ID } from './StatusAlerts';
import WebhookUrlField from './WebhookUrlField';

export { buildValidate } from './SchemaField';

/** DOM anchors for sections other parts of the page link to. */
const SECTION_ANCHORS: Partial<Record<SettingsSectionKey, string>> = {
  account: ACCOUNT_SECTION_ID,
};

// --------------- Body component ---------------

interface BodyProps {
  /** Rendered at the right of the Connection heading (e.g. Test Connection). */
  connectionExtra?: ReactNode;
  currentConfig?: {
    applicationId: string;
    credentials: Record<string, string>;
    settings?: Record<string, unknown> | null;
  };
  disabled?: boolean;
  form: FormInstance<ChannelFormValues>;
  hasConfig?: boolean;
  /** Saves and connects the credentials; resolves `false` when saving failed. */
  onAuthenticated?: (params: {
    applicationId: string;
    credentials: Record<string, string>;
  }) => Promise<boolean> | void;
  /** Removes the saved channel; the Danger zone offers it only for a saved bot. */
  onDelete?: () => void;
  onValuesChange?: (values: ChannelFormValues) => void;
  platformDef: SerializedPlatformDefinition;
  /** Name a quick-created bot app starts with (the agent's name). */
  quickSetupAppName?: string;
  /** Who a quick-created bot app is for (the agent id); a new scope starts a new scan. */
  quickSetupScope?: string;
  /** Removing is unavailable (read-only, or a save / connect is in flight). */
  removeDisabled?: boolean;
}

/**
 * A channel's configuration as settings sections: how the bot connects, who may
 * talk to it, which platform account is the operator's, how it replies and when
 * it wakes up, then the destructive actions. Until the bot is first saved the
 * settings sections start folded, so the page leads with the credentials.
 */
const Body = memo<BodyProps>(
  ({
    connectionExtra,
    platformDef,
    form,
    hasConfig,
    currentConfig,
    onAuthenticated,
    onDelete,
    onValuesChange,
    disabled,
    quickSetupAppName,
    quickSetupScope,
    removeDisabled,
  }) => {
    const { t: _t } = useTranslation('agent');
    const t = _t as (key: string, options?: Record<string, unknown>) => string;

    const CustomCredentialBody = platformCredentialBodyMap[platformDef.id];
    const CredentialExtras = platformCredentialExtrasMap[platformDef.id];

    const featureFlags = useServerConfigStore((s) => s.featureFlags) as
      Record<string, unknown> | undefined;

    const credentialFields = useMemo(
      () => getFields(platformDef.schema, 'credentials', featureFlags),
      [platformDef.schema, featureFlags],
    );

    const settingsFields = useMemo(
      () => getFields(platformDef.schema, 'settings', featureFlags),
      [platformDef.schema, featureFlags],
    );

    const { connection: connectionSettings, sections } = useMemo(
      () => groupSettingsFields(settingsFields),
      [settingsFields],
    );

    const handleResetSettings = useCallback(() => {
      form.setValues({
        settings: extractSettingsDefaults(platformDef.schema) as Record<string, {} | undefined>,
      });
      onValuesChange?.(form.getValues());
    }, [form, onValuesChange, platformDef.schema]);

    // A settings-field helper writes straight into the form, which does not
    // fire the Form's `onValuesChange` — same reason `handleResetSettings`
    // reports its own write. Without this the page never sees the change and
    // the unsaved-changes affordances stay hidden.
    const handleFieldExtrasFilled = useCallback(() => {
      onValuesChange?.(form.getValues());
    }, [form, onValuesChange]);

    const renderSettingsField = (field: FieldSchema, index: number) => {
      // Feature-gated fields (e.g. watch keywords) lock when the resolved
      // access meta reports the feature as not allowed.
      const featureLocked =
        !!field.paidFeature && platformDef.access?.features?.[field.paidFeature]?.allowed === false;
      const FieldExtras = platformSettingsFieldExtrasMap[`${platformDef.id}:${field.key}`];
      return (
        <Fragment key={field.key}>
          <SchemaField
            disabled={disabled}
            divider={index > 0}
            featureLocked={featureLocked}
            field={field}
            parentKey="settings"
          />
          {FieldExtras && (
            <FieldExtras
              disabled={disabled || featureLocked}
              platformId={platformDef.id}
              savedValue={currentConfig?.settings?.[field.key]}
              onFilled={handleFieldExtrasFilled}
            />
          )}
        </Fragment>
      );
    };

    // Render top-level sections in schema order so each platform controls its
    // own field ordering. LINE places `credentials` before `applicationId`
    // because the operator must enter the channel access token before the
    // "Fetch from LINE" button (rendered after applicationId) can auto-fill the
    // destination user ID; Discord/Slack/QQ/Feishu place `applicationId` first
    // as a primary identifier.
    const credentialRows = platformDef.schema
      .filter((section) => section.key === 'applicationId' || section.key === 'credentials')
      .flatMap((section) => {
        if (section.key === 'applicationId') return [{ field: section, key: 'applicationId' }];
        return credentialFields.map((field) => ({ field, key: field.key }));
      });

    const showReset = !!hasConfig && settingsFields.length > 0;
    const showRemove = hasConfig && !!onDelete;

    return (
      <Form form={form} style={{ width: '100%' }} variant={'filled'}>
        {!CustomCredentialBody && (
          <QuickSetupSection
            appName={quickSetupAppName || 'LobeHub'}
            // Remount when the bot is saved or removed: the steps' open state is
            // mount-only and should follow whether there is anything saved.
            disabled={disabled}
            form={form}
            hasConfig={hasConfig}
            key={hasConfig ? 'saved' : 'new'}
            platformId={platformDef.id}
            platformName={platformDef.name}
            scope={quickSetupScope}
            onAuthenticated={onAuthenticated}
          />
        )}

        <Form.Group
          collapsible={false}
          desc={t('channel.section.connection.desc', { name: platformDef.name })}
          extra={connectionExtra}
          title={t('channel.section.connection.title')}
          variant={'filled'}
        >
          {CustomCredentialBody ? (
            <CustomCredentialBody
              currentConfig={currentConfig}
              disabled={disabled}
              hasConfig={hasConfig}
              onAuthenticated={onAuthenticated}
            />
          ) : (
            <>
              {credentialRows.map(({ field, key }, index) =>
                key === 'applicationId' ? (
                  <ApplicationIdField
                    disabled={disabled}
                    divider={index > 0}
                    field={field}
                    key="applicationId"
                  />
                ) : (
                  <SchemaField
                    disabled={disabled}
                    divider={index > 0}
                    field={field}
                    key={key}
                    parentKey="credentials"
                  />
                ),
              )}
              {/* Platform-specific helpers (e.g. LINE's "Fetch from LINE" button)
              render after the credential + applicationId block so the button
              sits next to the field it acts on. */}
              {CredentialExtras && <CredentialExtras disabled={disabled} />}
            </>
          )}
          {connectionSettings.map((field) => renderSettingsField(field, 1))}
          {hasConfig && <WebhookUrlField form={form} platformDef={platformDef} />}
        </Form.Group>

        {sections.map(({ fields, key }) => (
          <Form.Group
            collapsible={!hasConfig}
            defaultActive={!!hasConfig}
            desc={t(`channel.section.${key}.desc`, { defaultValue: '', name: platformDef.name })}
            id={SECTION_ANCHORS[key]}
            key={`${platformDef.id}:${key}:${hasConfig ? 'saved' : 'new'}`}
            keyValue={`channel-section-${key}`}
            title={t(`channel.section.${key}.title`)}
            variant={'filled'}
          >
            {fields.map(renderSettingsField)}
          </Form.Group>
        ))}

        {(showReset || showRemove) && (
          <Form.Group
            collapsible={false}
            title={t('channel.section.danger.title')}
            variant={'filled'}
          >
            {showReset && (
              <Form.Field
                desc={t('channel.dangerZone.resetDesc')}
                label={t('channel.settingsResetDefault')}
              >
                <Button
                  disabled={disabled}
                  icon={<RotateCcw size={14} />}
                  onClick={() =>
                    confirmModal({
                      content: t('channel.dangerZone.resetConfirm'),
                      okText: t('channel.settingsResetDefault'),
                      title: t('channel.settingsResetDefault'),
                      onOk: handleResetSettings,
                    })
                  }
                >
                  {t('channel.settingsResetDefault')}
                </Button>
              </Form.Field>
            )}
            {showRemove && (
              <Form.Field
                desc={t('channel.dangerZone.removeDesc', { name: platformDef.name })}
                divider={showReset}
                label={t('channel.removeChannel')}
              >
                <Button
                  danger
                  disabled={removeDisabled}
                  icon={<Trash2 size={14} />}
                  onClick={onDelete}
                >
                  {t('channel.removeChannel')}
                </Button>
              </Form.Field>
            )}
          </Form.Group>
        )}
      </Form>
    );
  },
);

export default Body;
