'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Flexbox, Form, Tag, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';

const APP_ENVIRONMENT_ITEMS = [
  {
    descKey: 'settingSystemTools.appEnvironment.electron.desc',
    name: 'Electron',
    versionKey: 'electronVersion',
  },
  {
    descKey: 'settingSystemTools.appEnvironment.chromium.desc',
    name: 'Chromium',
    versionKey: 'chromeVersion',
  },
  {
    descKey: 'settingSystemTools.appEnvironment.node.desc',
    name: 'Node.js',
    versionKey: 'nodeVersion',
  },
] as const;

const AppEnvironmentSection = memo(() => {
  const { t } = useTranslation('setting');
  const lobeEnv = window.lobeEnv;

  const formItems: FormGroupItemType[] = [
    {
      children: APP_ENVIRONMENT_ITEMS.map((item) => {
        const version = lobeEnv?.[item.versionKey];
        const label = (
          <Flexbox horizontal align="center" gap={8}>
            <Text>{item.name}</Text>
            {version && (
              <Tag color="processing" style={{ marginInlineStart: 0 }}>
                {version}
              </Tag>
            )}
          </Flexbox>
        );
        return {
          desc: t(item.descKey),
          label,
          minWidth: undefined,
        };
      }),
      desc: t('settingSystemTools.appEnvironment.desc'),
      title: t('settingSystemTools.appEnvironment.title'),
    },
  ];

  return (
    <Form
      collapsible={false}
      items={formItems}
      itemsType={'group'}
      variant={'filled'}
      {...FORM_STYLE}
    />
  );
});

export default AppEnvironmentSection;
