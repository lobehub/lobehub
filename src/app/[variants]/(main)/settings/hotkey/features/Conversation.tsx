'use client';

import { type FormGroupItemType } from '@lobehub/ui';
import { Form, HotkeyInput, Icon, Skeleton } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { Loader2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HOTKEYS_REGISTRATION } from '@/const/hotkeys';
import { FORM_STYLE } from '@/const/layoutTokens';
import hotkeyMeta from '@/locales/default/hotkey';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';
import { type HotkeyItem } from '@/types/hotkey';
import { HotkeyGroupEnum } from '@/types/hotkey';

const HotkeySetting = memo(() => {
  const { t } = useTranslation(['setting', 'hotkey']);
  const [form] = Form.useForm();

  const { hotkey } = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [setSettings, isUserStateInit] = useUserStore((s) => [s.setSettings, s.isUserStateInit]);
  const [loading, setLoading] = useState(false);

  if (!isUserStateInit) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;

  const mapHotkeyItem = (item: HotkeyItem) => {
    const hotkeyConflicts = Object.entries(hotkey)
      .map(([key, value]) => {
        if (key === item.id) return false;
        return value;
      })
      .filter(Boolean) as string[];

    return {
      children: (
        <HotkeyInput
          disabled={item.nonEditable}
          hotkeyConflicts={hotkeyConflicts}
          placeholder={t('hotkey.record')}
          resetValue={item.keys}
        />
      ),
      desc: hotkeyMeta[`${item.id}.desc`] ? t(`${item.id}.desc`, { ns: 'hotkey' }) : undefined,
      label: t(`${item.id}.title`, { ns: 'hotkey' }),
      name: item.id,
    };
  };

  const conversation: FormGroupItemType = {
    children: HOTKEYS_REGISTRATION.filter(
      (item) => item.group === HotkeyGroupEnum.Conversation,
    ).map((item) => mapHotkeyItem(item)),
    extra: loading && <Icon spin icon={Loader2Icon} size={16} style={{ opacity: 0.5 }} />,
    title: t('hotkey.group.conversation'),
  };

  return (
    <Form
      collapsible={false}
      form={form}
      initialValues={hotkey}
      items={[conversation]}
      itemsType={'group'}
      variant={'filled'}
      onValuesChange={async (values) => {
        setLoading(true);
        await setSettings({ hotkey: values });
        setLoading(false);
      }}
      {...FORM_STYLE}
    />
  );
});

export default HotkeySetting;
