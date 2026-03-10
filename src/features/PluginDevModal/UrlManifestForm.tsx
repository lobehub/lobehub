import { BRANDING_NAME } from '@lobechat/business-const';
import { type LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { ActionIcon, Checkbox, Flexbox, FormItem, Input } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { Form } from 'antd';
import { FileCode, RotateCwIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ManifestPreviewer from '@/components/ManifestPreviewer';
import { toolService } from '@/services/tool';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';
import { type PluginInstallError } from '@/types/tool/plugin';

interface ProxyCheckerProps {
  onChange?: (value: boolean) => void;
  value?: boolean;
}

const ProxyChecker = memo<ProxyCheckerProps>(({ value, onChange }) => {
  const { t } = useTranslation('plugin');

  return (
    <Flexbox
      horizontal
      gap={8}
      style={{ cursor: 'pointer' }}
      onClick={() => {
        onChange?.(!value);
      }}
    >
      <Checkbox checked={value} /> {t('dev.customParams.useProxy.label')}
    </Flexbox>
  );
});

const UrlManifestForm = memo<{ form: FormInstance; isEditMode: boolean }>(
  ({ form, isEditMode }) => {
    const { t } = useTranslation('plugin');

    const [manifest, setManifest] = useState<LobeChatPluginManifest>();

    const urlKey = ['customParams', 'manifestUrl'];
    const proxyKey = ['customParams', 'useProxy'];
    const pluginIds = useToolStore(pluginSelectors.storeAndInstallPluginsIdList);

    return (
      <Form form={form} layout={'vertical'}>
        <FormItem
          hasFeedback
          required
          label={t('dev.meta.manifest.label')}
          name={urlKey}
          style={{ marginBottom: 0 }}
          desc={
            <Flexbox horizontal justify={'space-between'} style={{ marginTop: 8 }}>
              {t('dev.meta.manifest.desc', { appName: BRANDING_NAME })}
              {manifest && (
                <ManifestPreviewer manifest={manifest}>
                  <ActionIcon
                    icon={FileCode}
                    size={'small'}
                    title={t('dev.meta.manifest.preview')}
                  />
                </ManifestPreviewer>
              )}
            </Flexbox>
          }
          rules={[
            { required: true },
            {
              message: t('error.urlError'),
              pattern: /^https?:\/\/.*/,
            },
            {
              validator: async (_, value) => {
                if (!value) return true;

                try {
                  const useProxy = form.getFieldValue(proxyKey);
                  const data = await toolService.getToolManifest(value, useProxy);
                  setManifest(data);

                  form.setFieldsValue({ identifier: data.identifier, manifest: data });
                } catch (error) {
                  const err = error as PluginInstallError;
                  throw t(`error.${err.message}`, { error: err.cause! });
                }
              },
            },
            // 编辑模式下，不进行重复校验
            isEditMode
              ? {}
              : {
                  message: t('dev.meta.identifier.errorDuplicate'),
                  validator: async () => {
                    const id = form.getFieldValue('identifier');
                    if (!id) return true;

                    if (pluginIds.includes(id)) {
                      throw new Error('Duplicate');
                    }
                  },
                },
          ]}
        >
          <Input
            placeholder={'http://localhost:3400/manifest-dev.json'}
            suffix={
              <ActionIcon
                icon={RotateCwIcon}
                size={'small'}
                title={t('dev.meta.manifest.refresh')}
                onClick={(e) => {
                  e.stopPropagation();
                  form.validateFields([urlKey, 'identifier']);
                }}
              />
            }
          />
        </FormItem>

        <FormItem noStyle name={proxyKey}>
          <ProxyChecker />
        </FormItem>

        <FormItem noStyle name={'identifier'} />
        <FormItem noStyle name={'manifest'} />
      </Form>
    );
  },
);

export default UrlManifestForm;
