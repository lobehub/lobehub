import { LanguagesIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions } from '@/locales/resources';

import { useConversationStore } from '../../../../store';
import { defineAction } from '../defineAction';

export const translateAction = defineAction({
  key: 'translate',
  useBuild: (ctx) => {
    const { t } = useTranslation(['common', 'chat']);
    const translateMessage = useConversationStore((s) => s.translateMessage);

    return useMemo(
      () => ({
        children: localeOptions.map((i) => ({
          handleClick: () => translateMessage(ctx.id, i.value),
          key: i.value,
          label: t(`lang.${i.value}`, { ns: 'common' }),
        })),
        icon: LanguagesIcon,
        key: 'translate',
        label: t('translate.action', { ns: 'chat' }),
      }),
      [t, ctx.id, translateMessage],
    );
  },
});
