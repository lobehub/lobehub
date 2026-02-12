'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AES_GCM_URL, BASE_PROVIDER_DOC_URL, FORM_STYLE, isDesktop } from '@lobechat/const';
import { ProviderCombine } from '@lobehub/icons';
import { type FormGroupItemType, type FormItemProps } from '@lobehub/ui';
import {
  Avatar,
  Center,
  Flexbox,
  Form,
  Icon,
  Skeleton,
  Tooltip,
  stopPropagation,
} from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Form as AntdForm, Switch } from 'antd';
import { createStaticStyles, cssVar, cx, responsive } from 'antd-style';
import { Loader2Icon, LockIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useCallback, useLayoutEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import urlJoin from 'url-join';
import { z } from 'zod';

import { FormInput, FormPassword } from '@/components/FormInput';
import { SkeletonInput, SkeletonSwitch } from '@/components/Skeleton';
import { lambdaQuery } from '@/libs/trpc/client';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import { type AiProviderDetailItem, type AiProviderSourceType } from '@/types/aiProvider';
import { AiProviderSourceEnum } from '@/types/aiProvider';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import { type CheckErrorRender } from './Checker';
import Checker from './Checker';
import EnableSwitch from './EnableSwitch';
import OAuthDeviceFlowAuth from './OAuthDeviceFlowAuth';
import UpdateProviderInfo from './UpdateProviderInfo';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  aceGcm: css`
    padding-block: 0 !important;
    .${prefixCls}-form-item-label {
      display: none;
    }
    .${prefixCls}-form-item-control {
      width: 100%;

      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
      text-align: center;

      opacity: 0.66;

      transition: opacity 0.2s ${cssVar.motionEaseInOut};

      &:hover {
        opacity: 1;
      }
    }
  `,
  form: css`
    .${prefixCls}-form-item-control:has(.${prefixCls}-input,.${prefixCls}-select) {
      flex: none;
    }
    ${responsive.sm} {
      width: 100%;
      min-width: unset !important;
    }
    .${prefixCls}-select-selection-overflow-item {
      font-size: 12px;
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
  apiKeyItems?: FormItemProps[];
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
    const [form] = Form.useForm();

    const isOAuthProvider = authType === 'oauthDeviceFlow';

    // Query OAuth authentication status (only for OAuth providers)
    const { data: oauthStatus } = lambdaQuery.oauthDeviceFlow.getAuthStatus.useQuery(
      { providerId: id },
      { enabled: isOAuthProvider, refetchOnWindowFocus: true },
    );
    const isOAuthAuthenticated = oauthStatus?.isAuthenticated ?? false;

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

    // Watch form values in real-time to show/hide switches immediately
    // Watch nested form values for endpoints
    const formBaseURL = AntdForm.useWatch(['keyVaults', 'baseURL'], form);
    const formEndpoint = AntdForm.useWatch(['keyVaults', 'endpoint'], form);
    // Watch all possible credential fields for different providers
    const formApiKey = AntdForm.useWatch(['keyVaults', 'apiKey'], form);
    const formAccessKeyId = AntdForm.useWatch(['keyVaults', 'accessKeyId'], form);
    const formSecretAccessKey = AntdForm.useWatch(['keyVaults', 'secretAccessKey'], form);
    const formUsername = AntdForm.useWatch(['keyVaults', 'username'], form);
    const formPassword = AntdForm.useWatch(['keyVaults', 'password'], form);

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

      // Set form values and mark as initialized
      form.setFieldsValue(mergedData);
      lastInitializedIdRef.current = id;
    }, [isLoading, id, data, providerRuntimeConfig, form]);

    // 标记是否正在进行连接测试
    const isCheckingConnection = useRef(false);

    const handleValueChange = useCallback(
      (...params: Parameters<typeof updateAiProviderConfig>) => {
        // 虽然 debouncedHandleValueChange 早于 onBeforeCheck 执行，
        // 但是由于 debouncedHandleValueChange 因为 debounce 的原因，本来就会晚 500ms 执行
        // 所以 isCheckingConnection.current 这时候已经更新了
        // 测试链接时已经出发一次了 updateAiProviderConfig ， 不应该重复更新
        if (isCheckingConnection.current) return;

        updateAiProviderConfig(...params);
      },
      [updateAiProviderConfig],
    );
    const { run: debouncedHandleValueChange } = useDebounceFn(handleValueChange, {
      wait: 500,
    });

    const isCustom = source === AiProviderSourceEnum.Custom;

    // OAuth auth change handler
    const handleOAuthChange = useCallback(async () => {
      // Only refresh provider data, don't update with form values
      // OAuth tokens are saved directly to DB by the tRPC endpoint
      await useAiInfraStore.getState().refreshAiProviderDetail();
      await useAiInfraStore.getState().refreshAiProviderRuntimeState();
    }, []);

    const apiKeyItem: FormItemProps[] =
      !showApiKey || isOAuthProvider
        ? []
        : (apiKeyItems ?? [
            {
              children: isLoading ? (
                <SkeletonInput />
              ) : (
                <FormPassword
                  autoComplete={'new-password'}
                  placeholder={t('providerModels.config.apiKey.placeholder', { name })}
                  suffix={
                    configUpdating && (
                      <Icon spin icon={Loader2Icon} style={{ color: cssVar.colorTextTertiary }} />
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
              name: [KeyVaultsConfigKey, LLMProviderApiTokenKey],
            },
          ]);

    const aceGcmItem: FormItemProps = {
      children: (
        <>
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
        </>
      ),
      className: styles.aceGcm,
      minWidth: undefined,
    };

    const showEndpoint = !!proxyUrl || isCustom;

    const endpointItem = showEndpoint
      ? {
          children: isLoading ? (
            <SkeletonInput />
          ) : (
            <FormInput
              allowClear
              placeholder={
                (!!proxyUrl && proxyUrl?.placeholder) ||
                t('providerModels.config.baseURL.placeholder')
              }
              suffix={
                configUpdating && (
                  <Icon spin icon={Loader2Icon} style={{ color: cssVar.colorTextTertiary }} />
                )
              }
            />
          ),
          desc: (!!proxyUrl && proxyUrl?.desc) || t('providerModels.config.baseURL.desc'),
          label: (!!proxyUrl && proxyUrl?.title) || t('providerModels.config.baseURL.title'),
          name: [KeyVaultsConfigKey, LLMProviderBaseUrlKey],
          rules: [
            {
              validator: (_: any, value: string) => {
                if (!value) return;

                return z.string().url().safeParse(value).error
                  ? Promise.reject(t('providerModels.config.baseURL.invalid'))
                  : Promise.resolve();
              },
            },
          ],
        }
      : undefined;

    /*
     * Conditions to show Client Fetch Switch
     * 0. is not desktop app
     * 1. provider is not disabled browser request
     * 2. provider show browser request by default
     * 3. Provider allow to edit endpoint and the value of endpoint is not empty
     * 4. There is an apikey provided by user
     */
    const showClientFetch =
      !isDesktop &&
      !disableBrowserRequest &&
      (defaultShowBrowserRequest ||
        (showEndpoint && isProviderEndpointNotEmpty) ||
        (showApiKey && isProviderApiKeyNotEmpty));

    const clientFetchItem = showClientFetch
      ? {
          children: isLoading ? <SkeletonSwitch /> : <Switch loading={configUpdating} />,
          desc: t('providerModels.config.fetchOnClient.desc'),
          label: t('providerModels.config.fetchOnClient.title'),
          minWidth: undefined,
          name: 'fetchOnClient',
        }
      : undefined;

    const configItems = [
      ...apiKeyItem,
      endpointItem,
      supportResponsesApi
        ? {
            children: isLoading ? <Skeleton.Button active /> : <Switch loading={configUpdating} />,
            desc: t('providerModels.config.responsesApi.desc'),
            label: t('providerModels.config.responsesApi.title'),
            minWidth: undefined,
            name: ['config', 'enableResponseApi'],
          }
        : undefined,
      clientFetchItem,
      showChecker
        ? {
            children: isLoading ? (
              <Skeleton.Button active />
            ) : (
              <Checker
                checkErrorRender={checkErrorRender}
                model={data?.checkModel || checkModel!}
                provider={id}
                onAfterCheck={async () => {
                  // 重置连接测试状态，允许后续的 onValuesChange 更新
                  isCheckingConnection.current = false;
                }}
                onBeforeCheck={async () => {
                  // 设置连接测试状态，阻止 onValuesChange 的重复请求
                  isCheckingConnection.current = true;
                  // 主动保存表单最新值，确保 fetchAiProviderRuntimeState 获取最新数据
                  await updateAiProviderConfig(id, form.getFieldsValue());
                }}
              />
            ),
            desc: t('providerModels.config.checker.desc'),
            label: t('providerModels.config.checker.title'),
          }
        : undefined,
      showAceGcm && aceGcmItem,
    ].filter(Boolean) as FormItemProps[];

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
          ...(enabled ? {} : { filter: 'grayscale(100%)', maxHeight: 24, opacity: 0.66 }),
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
            {title ?? <ProviderCombine provider={id} size={24} />}
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
        {canDeactivate && !(ENABLE_BUSINESS_FEATURES && id === 'lobehub') && (
          <EnableSwitch id={id} key={id} />
        )}
      </Flexbox>
    );

    const model: FormGroupItemType = {
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
            extra={headerExtra}
            name={name || id}
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
            onValuesChange={(_, values) => {
              debouncedHandleValueChange(id, values);
            }}
            {...FORM_STYLE}
          />
        )}
      </>
    );
  },
);

export default ProviderConfig;
