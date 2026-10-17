'use client';

import { BRANDING_PROVIDER } from '@lobechat/business-const';
import { AES_GCM_URL, BASE_PROVIDER_DOC_URL, FORM_STYLE } from '@lobechat/const';
import {
  Avatar,
  Center,
  createStaticStyles,
  cssVar,
  cx,
  Flexbox,
  Icon,
  responsive,
  Skeleton,
  Spin,
  stopPropagation,
  Switch,
  Tooltip,
} from '@lobehub/ui';
import {
  Form,
  type FormFieldProps,
  type FormGroupItem,
  type FormValues,
  useForm,
  useWatch,
} from '@lobehub/ui/form';
import { useDebounceFn } from 'ahooks';
import { get, set } from 'es-toolkit/compat';
import { InfoIcon, LockIcon } from 'lucide-react';
import { AiProviderBaseURLSchema } from 'model-bank/aiProvider';
import { type ReactNode } from 'react';
import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { FormInput, FormPassword } from '@/components/FormInput';
import { ProviderCombine, ProviderIcon } from '@/components/LobeIcons';
import { SkeletonInput, SkeletonSwitch } from '@/components/Skeleton';
import { usePermission } from '@/hooks/usePermission';
import { lambdaQuery } from '@/libs/trpc/client';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import {
  type AiProviderDetailItem,
  type AiProviderSourceType,
  type UpdateAiProviderConfigParams,
} from '@/types/aiProvider';
import { AiProviderSourceEnum } from '@/types/aiProvider';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { isResponsesApiSupportedSdkType } from '../providerSettings';
import { type CheckErrorRender } from './Checker';
import Checker from './Checker';
import EnableSwitch from './EnableSwitch';
import OAuthDeviceFlowAuth from './OAuthDeviceFlowAuth';
import UpdateProviderInfo from './UpdateProviderInfo';

const styles = createStaticStyles(({ css, cssVar }) => ({
  aceGcm: css`
    width: 100%;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-align: center;

    opacity: 0.66;

    transition: opacity 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      opacity: 1;
    }
  `,
  form: css`
    ${responsive.sm} {
      width: 100%;
      min-width: unset !important;
    }
  `,
  help: css`
    border-radius: 50%;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorFillTertiary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFill};
    }
  `,
  switchLoading: css`
    width: 44px !important;
    min-width: 44px !important;
    height: 22px !important;
    border-radius: 12px !important;
  `,
}));

export interface ProviderConfigProps extends Omit<AiProviderDetailItem, 'enabled' | 'source'> {
  apiKeyItems?: FormFieldProps[];
  apiKeyUrl?: string;
  canDeactivate?: boolean;
  checkErrorRender?: CheckErrorRender;
  className?: string;
  enabled?: boolean;
  extra?: ReactNode;
  hideSwitch?: boolean;
  modelList?: {
    azureDeployName?: boolean;
    notFoundContent?: ReactNode;
    placeholder?: string;
    showModelFetcher?: boolean;
  };
  normalizeConfigValues?: (values: UpdateAiProviderConfigParams) => UpdateAiProviderConfigParams;
  showAceGcm?: boolean;
  source?: AiProviderSourceType;
  title?: ReactNode;
}

const ProviderConfig = memo<ProviderConfigProps>(
  ({
    apiKeyItems,
    id,
    settings,
    checkModel,
    logo,
    className,
    checkErrorRender,
    canDeactivate = true,
    name,
    showAceGcm = true,
    extra,
    source = AiProviderSourceEnum.Builtin,
    apiKeyUrl,
    title,
    normalizeConfigValues,
  }) => {
    const {
      authType,
      proxyUrl,
      showApiKey = true,
      defaultShowBrowserRequest,
      disableBrowserRequest,
      showChecker = true,
      supportResponsesApi,
    } = settings || {};
    const { t } = useTranslation('modelProvider');
    const form = useForm({
      onValuesChange: (_, values) => handleFormValuesChange(values),
    });
    const { allowed: canManageProvider } = usePermission('manage_provider_key');

    const isOAuthProvider = authType === 'oauthDeviceFlow';

    // Query OAuth authentication status (only for OAuth providers)
    const { data: oauthStatus } = lambdaQuery.oauthDeviceFlow.getAuthStatus.useQuery(
      { providerId: id },
      { enabled: isOAuthProvider, refetchOnWindowFocus: true },
    );
    const isOAuthAuthenticated = oauthStatus?.status === 'ACTIVE';

    const [
      data,
      updateAiProviderConfig,
      enabled,
      isLoading,
      configUpdating,
      providerRuntimeConfig,
    ] = useAiInfraStore((s) => [
      aiProviderSelectors.providerDetailById(id)(s),
      s.updateAiProviderConfig,
      aiProviderSelectors.isProviderEnabled(id)(s),
      aiProviderSelectors.isAiProviderConfigLoading(id)(s),
      aiProviderSelectors.isProviderConfigUpdating(id)(s),
      aiProviderSelectors.providerConfigById(id)(s),
    ]);
    const enableBusinessFeatures = useServerConfigStore(
      serverConfigSelectors.enableBusinessFeatures,
    );

    // Watch form values in real-time to show/hide switches immediately
    // Watch nested form values for endpoints
    const formBaseURL = useWatch(form, 'keyVaults.baseURL');
    const formEndpoint = useWatch(form, 'keyVaults.endpoint');
    // Watch all possible credential fields for different providers
    const formApiKey = useWatch(form, 'keyVaults.apiKey');
    const formAccessKeyId = useWatch(form, 'keyVaults.accessKeyId');
    const formSecretAccessKey = useWatch(form, 'keyVaults.secretAccessKey');
    const formUsername = useWatch(form, 'keyVaults.username');
    const formPassword = useWatch(form, 'keyVaults.password');

    // Check if provider has endpoint and apiKey based on runtime config
    // Fallback to data.keyVaults if runtime config is not yet loaded
    const keyVaults = providerRuntimeConfig?.keyVaults || data?.keyVaults;
    // Use form values first (for immediate update), fallback to stored values
    const isProviderEndpointNotEmpty =
      !!formBaseURL || !!formEndpoint || !!keyVaults?.baseURL || !!keyVaults?.endpoint;
    // Check if any credential is present for different authentication types:
    // - Standard apiKey (OpenAI, Azure, Cloudflare, VertexAI, etc.)
    // - AWS Bedrock credentials (accessKeyId, secretAccessKey)
    // - ComfyUI basic auth (username and password)
    const isProviderApiKeyNotEmpty = !!(
      formApiKey ||
      keyVaults?.apiKey ||
      formAccessKeyId ||
      keyVaults?.accessKeyId ||
      formSecretAccessKey ||
      keyVaults?.secretAccessKey ||
      (formUsername && formPassword) ||
      (keyVaults?.username && keyVaults?.password)
    );

    // Track the last initialized provider ID to avoid resetting form during edits
    const lastInitializedIdRef = useRef<string | null>(null);

    useLayoutEffect(() => {
      if (isLoading) return;

      // Only initialize form when:
      // 1. First load (lastInitializedIdRef.current === null)
      // 2. Provider ID changed (switching between providers)
      const shouldInitialize = lastInitializedIdRef.current !== id;
      if (!shouldInitialize) return;

      // Merge data from both sources to ensure all fields are initialized correctly
      // data: contains basic info like apiKey, baseURL, fetchOnClient
      // providerRuntimeConfig: contains nested config like enableResponseApi
      const mergedData = {
        ...data,
        ...(providerRuntimeConfig?.config && { config: providerRuntimeConfig.config }),
      };

      // Replace the previous provider's field state so omitted keys do not
      // leak old values when the next provider has empty credentials.
      form.reset(mergedData);
      lastInitializedIdRef.current = id;
    }, [isLoading, id, data, providerRuntimeConfig, form]);

    // Flag to indicate if a connection test is in progress
    const isCheckingConnection = useRef(false);

    const handleValueChange = useCallback(
      (...params: Parameters<typeof updateAiProviderConfig>) => {
        // Although debouncedHandleValueChange executes before onBeforeCheck,
        // due to the debounce, debouncedHandleValueChange will actually execute 500ms later
        // so isCheckingConnection.current has already been updated at this point
        // updateAiProviderConfig has already been triggered once during the connection test, so it should not be updated again
        if (isCheckingConnection.current) return;

        updateAiProviderConfig(...params);
      },
      [updateAiProviderConfig],
    );

    const normalizeValues = useCallback(
      (values: UpdateAiProviderConfigParams) => normalizeConfigValues?.(values) ?? values,
      [normalizeConfigValues],
    );

    const { cancel: cancelDebouncedHandleValueChange, run: debouncedHandleValueChange } =
      useDebounceFn(handleValueChange, { wait: 500 });

    const isCustom = source === AiProviderSourceEnum.Custom;

    // OAuth auth change handler
    const handleOAuthChange = useCallback(async () => {
      // Only refresh provider data, don't update with form values
      // OAuth tokens are saved directly to DB by the tRPC endpoint
      await useAiInfraStore.getState().refreshAiProviderDetail();
      await useAiInfraStore.getState().refreshAiProviderRuntimeState();
    }, []);

    const apiKeyItem: FormFieldProps[] =
      !showApiKey || isOAuthProvider
        ? []
        : (apiKeyItems ?? [
            {
              children: isLoading ? (
                <SkeletonInput />
              ) : (
                <FormPassword
                  autoComplete={'new-password'}
                  disabled={!canManageProvider}
                  placeholder={t('providerModels.config.apiKey.placeholder', { name })}
                  suffix={
                    configUpdating && (
                      <Spin size="small" style={{ color: cssVar.colorTextTertiary }} />
                    )
                  }
                />
              ),
              desc: apiKeyUrl ? (
                <Trans
                  i18nKey="providerModels.config.apiKey.descWithUrl"
                  ns={'modelProvider'}
                  values={{ name }}
                  components={[
                    <span key="0" />,
                    <span key="1" />,
                    <span key="2" />,
                    <a href={apiKeyUrl} key="3" rel="noreferrer" target="_blank" />,
                  ]}
                />
              ) : (
                t(`providerModels.config.apiKey.desc`, { name })
              ),
              label: t(`providerModels.config.apiKey.title`),
              name: `${KeyVaultsConfigKey}.${LLMProviderApiTokenKey}`,
            },
          ]);

    const aceGcmItem: FormFieldProps = {
      bare: true,
      children: (
        <div className={styles.aceGcm}>
          <Icon icon={LockIcon} style={{ marginRight: 4 }} />
          <Trans
            i18nKey="providerModels.config.aesGcm"
            ns={'modelProvider'}
            components={[
              <span key="0" />,
              <a
                href={AES_GCM_URL}
                key="1"
                rel="noreferrer"
                style={{ marginInline: 4 }}
                target="_blank"
              />,
            ]}
          />
        </div>
      ),
    };

    const showEndpoint = !!proxyUrl || isCustom;

    const endpointItem: FormFieldProps | undefined = showEndpoint
      ? {
          children: isLoading ? (
            <SkeletonInput />
          ) : (
            <FormInput
              allowClear
              disabled={!canManageProvider}
              placeholder={
                (!!proxyUrl && proxyUrl?.placeholder) ||
                t('providerModels.config.baseURL.placeholder')
              }
              suffix={
                configUpdating && <Spin size="small" style={{ color: cssVar.colorTextTertiary }} />
              }
            />
          ),
          desc: (!!proxyUrl && proxyUrl?.desc) || t('providerModels.config.baseURL.desc'),
          label: (!!proxyUrl && proxyUrl?.title) || t('providerModels.config.baseURL.title'),
          name: `${KeyVaultsConfigKey}.${LLMProviderBaseUrlKey}`,
          validate: (value?: string) =>
            value && AiProviderBaseURLSchema.safeParse(value).error
              ? t('providerModels.config.baseURL.invalid')
              : undefined,
        }
      : undefined;

    /*
     * Conditions to show Client Fetch Switch
     * 1. provider is not disabled browser request
     * 2. provider show browser request by default
     * 3. Provider allow to edit endpoint and the value of endpoint is not empty
     * 4. There is an apikey provided by user
     */
    const showClientFetch =
      !disableBrowserRequest &&
      (defaultShowBrowserRequest ||
        (showEndpoint && isProviderEndpointNotEmpty) ||
        (showApiKey && isProviderApiKeyNotEmpty));

    const clientFetchItem: FormFieldProps | undefined = showClientFetch
      ? {
          children: isLoading ? (
            <SkeletonSwitch />
          ) : (
            <Switch disabled={!canManageProvider} loading={configUpdating} />
          ),
          desc: t('providerModels.config.fetchOnClient.desc'),
          label: t('providerModels.config.fetchOnClient.title'),
          minWidth: undefined,
          name: 'fetchOnClient',
        }
      : undefined;

    const showResponsesApiSwitch =
      !!supportResponsesApi || (isCustom && isResponsesApiSupportedSdkType(settings?.sdkType));

    const configItems = [
      ...apiKeyItem,
      endpointItem,
      showResponsesApiSwitch
        ? {
            children: isLoading ? (
              <Skeleton height={36} />
            ) : (
              <Switch disabled={!canManageProvider} loading={configUpdating} />
            ),
            desc: t('providerModels.config.responsesApi.desc'),
            label: t('providerModels.config.responsesApi.title'),
            minWidth: undefined,
            name: 'config.enableResponseApi',
          }
        : undefined,
      clientFetchItem,
      showChecker
        ? {
            children: isLoading ? (
              <Skeleton height={36} />
            ) : (
              <Checker
                checkErrorRender={checkErrorRender}
                model={data?.checkModel || checkModel!}
                provider={id}
                onAfterCheck={async () => {
                  // Reset connection test state to allow subsequent onValuesChange updates
                  isCheckingConnection.current = false;
                }}
                onBeforeCheck={async () => {
                  const { valid } = await form.validate();
                  if (!valid) return false;

                  // Set connection test state to prevent duplicate requests from onValuesChange
                  isCheckingConnection.current = true;
                  // Proactively save the latest form values to ensure fetchAiProviderRuntimeState retrieves up-to-date data
                  await updateAiProviderConfig(
                    id,
                    normalizeValues(pickFieldValues(form.getValues())),
                  );

                  return true;
                }}
              />
            ),
            desc: t('providerModels.config.checker.desc'),
            label: t('providerModels.config.checker.title'),
          }
        : undefined,
      showAceGcm && aceGcmItem,
    ].filter(Boolean) as FormFieldProps[];

    const pickFieldValues = (values: FormValues): UpdateAiProviderConfigParams =>
      configItems.reduce<UpdateAiProviderConfigParams>((acc, item) => {
        if (item.name && !item.hidden) set(acc, item.name, get(values, item.name));
        return acc;
      }, {});

    const handleFormValuesChange = (values: FormValues) => {
      if (!canManageProvider) return;

      cancelDebouncedHandleValueChange();
      const baseURL = values.keyVaults?.baseURL;
      if (baseURL && !AiProviderBaseURLSchema.safeParse(baseURL).success) return;

      debouncedHandleValueChange(id, normalizeValues(pickFieldValues(values)));
    };

    const logoUrl = data?.logo ?? logo;

    // Header components - shared between OAuth card and Form
    const headerTitle = (
      <Flexbox
        horizontal
        align={'center'}
        gap={4}
        style={{
          height: 24,
          maxHeight: 24,
          // OAuth providers keep full-colour branding while off: the enable
          // switch sits right beside them, so dimming only adds noise
          ...(enabled || isOAuthProvider
            ? {}
            : { filter: 'grayscale(100%)', maxHeight: 24, opacity: 0.66 }),
        }}
      >
        {isCustom ? (
          <Flexbox horizontal align={'center'} gap={8}>
            {logoUrl ? (
              <Avatar avatar={logoUrl} shape={'circle'} size={32} title={name || id} />
            ) : (
              <ProviderCombine provider={'not-exist-provider'} size={24} />
            )}
            {name}
          </Flexbox>
        ) : (
          <>
            {title ??
              // OAuth providers sell a subscription plan rather than the vendor
              // platform, so the plan name reads truer than the vendor wordmark
              // the combined logo would render (e.g. ChatGPT vs. OpenAI).
              (isOAuthProvider ? (
                <Flexbox horizontal align={'center'} gap={8}>
                  <ProviderIcon
                    provider={id}
                    shape={'square'}
                    size={24}
                    style={{ borderRadius: 6 }}
                    type={'avatar'}
                  />
                  {name}
                </Flexbox>
              ) : (
                <ProviderCombine provider={id} size={24} />
              ))}
            <Tooltip title={t('providerModels.config.helpDoc')}>
              <a
                href={urlJoin(BASE_PROVIDER_DOC_URL, id)}
                rel="noreferrer"
                target="_blank"
                onClick={stopPropagation}
              >
                <Center className={styles.help} height={20} width={20}>
                  ?
                </Center>
              </a>
            </Tooltip>
          </>
        )}
      </Flexbox>
    );

    const headerExtra = (
      <Flexbox horizontal align={'center'} gap={8}>
        {extra}
        {isCustom && <UpdateProviderInfo />}
        {canDeactivate && !(enableBusinessFeatures && id === BRANDING_PROVIDER) && (
          <>
            {/* OAuth providers pair the switch with a connect action, so the
                built-in notice would crowd the row */}
            {!isCustom && !isOAuthProvider && (
              <Tooltip title={t('providerModels.config.builtinNotice')}>
                <Icon
                  color={cssVar.colorTextTertiary}
                  icon={InfoIcon}
                  size={16}
                  onClick={stopPropagation}
                />
              </Tooltip>
            )}
            <EnableSwitch id={id} key={id} />
          </>
        )}
      </Flexbox>
    );

    const model: FormGroupItem = {
      children: configItems,
      defaultActive: true,
      extra: isOAuthProvider ? undefined : headerExtra,
      title: isOAuthProvider ? '' : headerTitle,
    };

    // For OAuth providers, only show Form when authenticated
    const shouldShowForm = !isOAuthProvider || isOAuthAuthenticated;

    return (
      <>
        {isOAuthProvider && (
          <OAuthDeviceFlowAuth
            // when the provider cannot be deactivated there is no switch to
            // gate on, so the connect action stays available
            enabled={!canDeactivate || enabled}
            extra={headerExtra}
            providerId={id}
            title={headerTitle}
            onAuthChange={handleOAuthChange}
          />
        )}
        {shouldShowForm && (
          <Form
            className={cx(styles.form, className)}
            form={form}
            items={[model]}
            variant={'borderless'}
            {...FORM_STYLE}
          />
        )}
      </>
    );
  },
);

export default ProviderConfig;
