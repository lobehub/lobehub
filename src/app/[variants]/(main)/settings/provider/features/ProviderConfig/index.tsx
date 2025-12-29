'use client';

import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import { AES_GCM_URL, BASE_PROVIDER_DOC_URL, FORM_STYLE, isDesktop } from '@lobechat/const';
import { ProviderCombine } from '@lobehub/icons';
import {
  Avatar,
  Form,
  type FormGroupItemType,
  type FormItemProps,
  Icon,
  Tooltip,
} from '@lobehub/ui';
import { Center, Flexbox, Skeleton } from '@lobehub/ui';
import { useDebounceFn } from 'ahooks';
import { Switch } from 'antd';
import { createStaticStyles, cssVar, cx, responsive } from 'antd-style';
import { Loader2Icon, LockIcon } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, memo, useCallback, useLayoutEffect, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import urlJoin from 'url-join';
import { z } from 'zod';

import { FormInput, FormPassword } from '@/components/FormInput';
import { SkeletonInput, SkeletonSwitch } from '@/components/Skeleton';
import { aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';
import {
  type AiProviderDetailItem,
  AiProviderSourceEnum,
  type AiProviderSourceType,
} from '@/types/aiProvider';

import { KeyVaultsConfigKey, LLMProviderApiTokenKey, LLMProviderBaseUrlKey } from '../../const';
import Checker, { type CheckErrorRender } from './Checker';
import EnableSwitch from './EnableSwitch';
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
      width: min(70%, 800px);
      min-width: min(70%, 800px) !important;
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
      proxyUrl,
      showApiKey = true,
      defaultShowBrowserRequest,
      disableBrowserRequest,
      showChecker = true,
      supportResponsesApi,
    } = settings || {};
    const { t } = useTranslation('modelProvider');
    const [form] = Form.useForm();

    const [
      data,
      updateAiProviderConfig,
      enabled,
      isLoading,
      configUpdating,
      isFetchOnClient,
      enableResponseApi,
      isProviderEndpointNotEmpty,
      isProviderApiKeyNotEmpty,
    ] = useAiInfraStore((s) => [
      aiProviderSelectors.activeProviderConfig(s),
      s.updateAiProviderConfig,
      aiProviderSelectors.isProviderEnabled(id)(s),
      aiProviderSelectors.isAiProviderConfigLoading(id)(s),
      aiProviderSelectors.isProviderConfigUpdating(id)(s),
      aiProviderSelectors.isProviderFetchOnClient(id)(s),
      aiProviderSelectors.isProviderEnableResponseApi(id)(s),
      aiProviderSelectors.isActiveProviderEndpointNotEmpty(s),
      aiProviderSelectors.isActiveProviderApiKeyNotEmpty(s),
    ]);

    useLayoutEffect(() => {
      if (isLoading) return;

      // set the first time
      form.setFieldsValue(data);
    }, [isLoading, id, data]);

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

    const apiKeyItem: FormItemProps[] = !showApiKey
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
                    <Icon icon={Loader2Icon} spin style={{ color: cssVar.colorTextTertiary }} />
                  )
                }
              />
            ),
            desc: apiKeyUrl ? (
              <Trans
                components={[
                  <span key="0" />,
                  <span key="1" />,
                  <span key="2" />,
                  <Link href={apiKeyUrl} key="3" target={'_blank'} />,
                ]}
                i18nKey="providerModels.config.apiKey.descWithUrl"
                ns={'modelProvider'}
                values={{ name }}
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
            components={[
              <span key="0" />,
              <Link href={AES_GCM_URL} key="1" style={{ marginInline: 4 }} target={'_blank'} />,
            ]}
            i18nKey="providerModels.config.aesGcm"
            ns={'modelProvider'}
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
                  <Icon icon={Loader2Icon} spin style={{ color: cssVar.colorTextTertiary }} />
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
    const clientFetchItem = showClientFetch && {
      children: isLoading ? (
        <SkeletonSwitch />
      ) : (
        <Switch checked={isFetchOnClient} disabled={configUpdating} />
      ),
      desc: t('providerModels.config.fetchOnClient.desc'),
      label: t('providerModels.config.fetchOnClient.title'),
      minWidth: undefined,
      name: 'fetchOnClient',
    };

    const configItems = [
      ...apiKeyItem,
      endpointItem,
      supportResponsesApi
        ? {
            children: isLoading ? (
              <Skeleton.Button active />
            ) : (
              <Switch loading={configUpdating} value={enableResponseApi} />
            ),
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
                provider={id}
              />
            ),
            desc: t('providerModels.config.checker.desc'),
            label: t('providerModels.config.checker.title'),
            minWidth: undefined,
          }
        : undefined,
      showAceGcm && aceGcmItem,
    ].filter(Boolean) as FormItemProps[];

    const logoUrl = data?.logo ?? logo;
    const model: FormGroupItemType = {
      children: configItems,

      defaultActive: true,

      extra: (
        <Flexbox align={'center'} gap={8} horizontal>
          {extra}

          {isCustom && <UpdateProviderInfo />}
          {canDeactivate && !(ENABLE_BUSINESS_FEATURES && id === 'lobehub') && (
            <EnableSwitch id={id} />
          )}
        </Flexbox>
      ),
      title: (
        <Flexbox
          align={'center'}
          gap={4}
          horizontal
          style={{
            height: 24,
            maxHeight: 24,
            ...(enabled ? {} : { filter: 'grayscale(100%)', maxHeight: 24, opacity: 0.66 }),
          }}
        >
          {isCustom ? (
            <Flexbox align={'center'} gap={8} horizontal>
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
                <Link
                  href={urlJoin(BASE_PROVIDER_DOC_URL, id)}
                  onClick={(e) => e.stopPropagation()}
                  target={'_blank'}
                >
                  <Center className={styles.help} height={20} width={20}>
                    ?
                  </Center>
                </Link>
              </Tooltip>
            </>
          )}
        </Flexbox>
      ),
    };

    return (
      <Form
        className={cx(styles.form, className)}
        form={form}
        items={[model]}
        onValuesChange={(_, values) => {
          debouncedHandleValueChange(id, values);
        }}
        variant={'borderless'}
        {...FORM_STYLE}
      />
    );
  },
);

export default ProviderConfig;
