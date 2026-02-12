import { type FormItemProps } from '@lobehub/ui';
import { Form, Input, TextArea } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import EmojiPicker from '@/components/EmojiPicker';
import { useGlobalStore } from '@/store/global';
import { globalGeneralSelectors } from '@/store/global/selectors';
import { useToolStore } from '@/store/tool';
import { pluginSelectors } from '@/store/tool/selectors';

const LocalForm = memo<{ form: FormInstance; mode?: 'edit' | 'create' }>(({ form, mode }) => {
  const isEditMode = mode === 'edit';
  const locale = useGlobalStore(globalGeneralSelectors.currentLanguage);
  const { t } = useTranslation('plugin');

  const pluginIds = useToolStore(pluginSelectors.storeAndInstallPluginsIdList);

  const metaItem: FormItemProps[] = [
    {
      children: <Input disabled placeholder={'searchEngine'} />,
      desc: t('dev.meta.identifier.desc'),
      label: t('dev.meta.identifier.label'),
      name: 'identifier',
      rules: [
        { required: true },
        {
          message: t('dev.meta.identifier.pattenErrorMessage'),
          pattern: /^[\w-]+$/,
        },
        // 编辑模式下，不进行重复校验
        isEditMode
          ? {}
          : {
              message: t('dev.meta.identifier.errorDuplicate'),
              validator: async (_, value) => {
                if (pluginIds.includes(value)) {
                  throw new Error('Duplicate');
                }
              },
            },
      ],
    },
    {
      children: <Input placeholder={t('dev.meta.title.placeholder')} />,
      desc: t('dev.meta.title.desc'),
      label: t('dev.meta.title.label'),
      name: ['manifest', 'meta', 'title'],
      rules: [{ required: true }],
    },
    {
      children: <TextArea placeholder={t('dev.meta.description.placeholder')} />,
      desc: t('dev.meta.description.desc'),
      label: t('dev.meta.description.label'),
      name: ['manifest', 'meta', 'description'],
    },
    {
      children: <Input placeholder={'LobeHub'} />,
      desc: t('dev.meta.author.desc'),
      label: t('dev.meta.author.label'),
      name: ['manifest', 'author'],
    },
    {
      children: <Input placeholder={'https://www.lobehub.com'} />,
      desc: t('dev.meta.homepage.desc'),
      label: t('dev.meta.homepage.label'),
      name: ['manifest', 'homepage'],
    },
    {
      children: <EmojiPicker defaultAvatar={'🧩'} locale={locale} />,
      desc: t('dev.meta.avatar.desc'),
      label: t('dev.meta.avatar.label'),
      name: ['manifest', 'meta', 'avatar'],
    },
  ];

  const manifestItem: FormItemProps[] = [
    {
      children: <Input placeholder={'searchEngine'} />,
      desc: t('dev.meta.identifier.desc'),
      label: t('dev.meta.identifier.label'),
      name: ['name'],
      required: true,
    },

    {
      children: <Input placeholder={t('dev.meta.description.placeholder')} />,
      desc: t('dev.meta.description.desc'),
      label: t('dev.meta.description.label'),
      name: 'description',
      required: true,
    },
    {
      children: <Input placeholder={'searchEngine'} />,
      desc: t('dev.meta.identifier.desc'),
      label: t('dev.meta.identifier.label'),
      name: 'identifier',
      required: true,
    },
  ];

  return (
    <Form
      form={form}
      layout={'vertical'}
      items={[
        {
          children: metaItem,
          title: t('dev.metaConfig'),
        },
        {
          children: manifestItem,
          title: t('dev.metaConfig'),
        },
      ]}
      validateMessages={{
        required: () => t('dev.meta.formFieldRequired'),
      }}
    />
  );
});

export default LocalForm;
