'use client';

import { type UserImageConfig } from '@lobechat/types';
import { type FormGroupItemType } from '@lobehub/ui';
import { Form, Icon, Skeleton } from '@lobehub/ui';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormSliderWithInput } from '@/components/FormInput';
import { FORM_STYLE } from '@/const/layoutTokens';
import { MAX_DEFAULT_IMAGE_NUM, MIN_DEFAULT_IMAGE_NUM } from '@/const/settings';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/slices/settings/selectors';

const ImageSettings = memo(() => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm<UserImageConfig>();
  const [isUpdating, setIsUpdating] = useState(false);

  const imageSettings = useUserStore(settingsSelectors.currentImageSettings);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);

  if (!isUserStateInit) {
    return <Skeleton active paragraph={{ rows: 1 }} title={false} />;
  }

  const items: FormGroupItemType[] = [
    {
      children: [
        {
          children: (
            <FormSliderWithInput
              disabled={isUpdating}
              max={MAX_DEFAULT_IMAGE_NUM}
              min={MIN_DEFAULT_IMAGE_NUM}
              step={1}
            />
          ),
          desc: t('settingImage.defaultCount.desc'),
          label: t('settingImage.defaultCount.label'),
          name: 'defaultImageNum',
        },
      ],
      extra: isUpdating ? (
        <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.6 }} />
      ) : undefined,
      title: t('settingImage.defaultCount.title'),
    },
  ];

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={imageSettings}
      items={items}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={async (values) => {
        setIsUpdating(true);
        try {
          await setSettings({ image: values });
        } finally {
          setIsUpdating(false);
        }
      }}
      {...FORM_STYLE}
    />
  );
});

ImageSettings.displayName = 'ImageSettings';

export default ImageSettings;
