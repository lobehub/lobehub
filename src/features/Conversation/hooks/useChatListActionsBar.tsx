import { type ActionIconGroupItemType } from '@lobehub/ui';
import { css, cx } from 'antd-style';
import {
  ArrowDownFromLine,
  Copy,
  DownloadIcon,
  Edit,
  LanguagesIcon,
  ListChevronsDownUp,
  ListChevronsUpDown,
  ListRestart,
  Play,
  RotateCcw,
  Share2,
  Split,
  Trash,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { localeOptions } from '@/locales/resources';

const translateStyle = css`
  .ant-dropdown-menu-sub {
    overflow-y: scroll;
    max-height: 400px;
  }
`;

interface ChatListActionsBar {
  branching: ActionIconGroupItemType;
  collapse: ActionIconGroupItemType;
  continueGeneration: ActionIconGroupItemType;
  copy: ActionIconGroupItemType;
  del: ActionIconGroupItemType;
  delAndRegenerate: ActionIconGroupItemType;
  divider: { type: 'divider' };
  edit: ActionIconGroupItemType;
  expand: ActionIconGroupItemType;
  export: ActionIconGroupItemType;
  regenerate: ActionIconGroupItemType;
  share: ActionIconGroupItemType;
  translate: ActionIconGroupItemType;
  tts: ActionIconGroupItemType;
}

export const useChatListActionsBar = ({
  hasThread,
  isContinuing,
  isRegenerating,
}: {
  hasThread?: boolean;
  isContinuing?: boolean;
  isRegenerating?: boolean;
} = {}): ChatListActionsBar => {
  const { t } = useTranslation(['common', 'chat']);

  return useMemo<ChatListActionsBar>(
    () => ({
      branching: {
        icon: Split,
        key: 'branching',
        label: t('branching'),
      },
      collapse: {
        icon: ListChevronsDownUp,
        key: 'collapse',
        label: t('messageAction.collapse', { ns: 'chat' }),
      },
      continueGeneration: {
        disabled: isContinuing,
        icon: ArrowDownFromLine,
        key: 'continueGeneration',
        label: t('messageAction.continueGeneration', { ns: 'chat' }),
        spin: isContinuing,
      },
      copy: {
        icon: Copy,
        key: 'copy',
        label: t('copy'),
      },
      del: {
        danger: true,
        disabled: hasThread,
        icon: Trash,
        key: 'del',
        label: hasThread ? t('messageAction.deleteDisabledByThreads', { ns: 'chat' }) : t('delete'),
      },
      delAndRegenerate: {
        disabled: hasThread || isRegenerating,
        icon: ListRestart,
        key: 'delAndRegenerate',
        label: t('messageAction.delAndRegenerate', {
          ns: 'chat',
        }),
      },
      divider: {
        type: 'divider',
      },
      edit: {
        icon: Edit,
        key: 'edit',
        label: t('edit'),
      },
      expand: {
        icon: ListChevronsUpDown,
        key: 'expand',
        label: t('messageAction.expand', { ns: 'chat' }),
      },
      export: {
        icon: DownloadIcon,
        key: 'export',
        label: '导出为 PDF',
      },
      regenerate: {
        disabled: isRegenerating,
        icon: RotateCcw,
        key: 'regenerate',
        label: t('regenerate'),
        spin: isRegenerating,
      },
      share: {
        icon: Share2,
        key: 'share',
        label: t('share'),
      },
      translate: {
        children: localeOptions.map((i) => ({
          key: i.value,
          label: t(`lang.${i.value}`),
        })),
        icon: LanguagesIcon,
        key: 'translate',
        label: t('translate.action', { ns: 'chat' }),
        popupClassName: cx(translateStyle),
      },
      tts: {
        icon: Play,
        key: 'tts',
        label: t('tts.action', { ns: 'chat' }),
      },
    }),
    [hasThread, isContinuing, isRegenerating],
  );
};
