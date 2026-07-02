import { HotkeyEnum } from '@lobechat/const/hotkeys';
import { ActionIcon, Flexbox, Hotkey, Tooltip } from '@lobehub/ui';
import { Popconfirm } from 'antd';
import { LucideGalleryVerticalEnd, LucideMessageSquarePlus } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsMobile } from '@/hooks/useIsMobile';
import { usePermission } from '@/hooks/usePermission';
import { useActionSWR } from '@/libs/swr';
import { topicActionKeys } from '@/libs/swr/keys';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const SaveTopic = memo(() => {
  const { t } = useTranslation('chat');
  const hotkey = useUserStore(settingsSelectors.getHotkeyById(HotkeyEnum.SaveTopic));
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const [hasTopic, openNewTopicOrSaveTopic] = useChatStore((s) => [
    !!s.activeTopicId,
    s.openNewTopicOrSaveTopic,
  ]);

  const mobile = useIsMobile();

  const { mutate, isValidating } = useActionSWR(
    topicActionKeys.openNewOrSave(),
    openNewTopicOrSaveTopic,
  );

  const [confirmOpened, setConfirmOpened] = useState(false);

  const icon = hasTopic ? LucideMessageSquarePlus : LucideGalleryVerticalEnd;
  const desc = t(hasTopic ? 'topic.openNewTopic' : 'topic.saveCurrentMessages');

  const handleMutate = useCallback(() => {
    if (!canCreateContent) return;

    mutate();
  }, [canCreateContent, mutate]);

  const handleConfirmOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!canCreateContent) return;

      setConfirmOpened(nextOpen);
    },
    [canCreateContent],
  );

  if (mobile) {
    return (
      <Popconfirm
        arrow={false}
        okButtonProps={{ danger: false, type: 'primary' }}
        open={canCreateContent && confirmOpened}
        placement={'top'}
        title={
          <Flexbox horizontal align={'center'} style={{ marginBottom: 8 }}>
            <div style={{ marginRight: '16px', whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
              {t(hasTopic ? 'topic.checkOpenNewTopic' : 'topic.checkSaveCurrentMessages')}
            </div>
            <Hotkey keys={hotkey} />
          </Flexbox>
        }
        onConfirm={handleMutate}
        onOpenChange={handleConfirmOpenChange}
      >
        <Tooltip title={canCreateContent ? desc : reason}>
          <div>
            <ActionIcon
              aria-label={desc}
              disabled={!canCreateContent}
              icon={icon}
              loading={isValidating}
              onClick={() => handleConfirmOpenChange(true)}
            />
          </div>
        </Tooltip>
      </Popconfirm>
    );
  } else {
    return (
      <ActionIcon
        aria-label={desc}
        disabled={!canCreateContent}
        icon={icon}
        loading={isValidating}
        size={{ blockSize: 32, size: 16, strokeWidth: 2.3 }}
        title={canCreateContent ? desc : reason}
        variant={'outlined'}
        tooltipProps={{
          hotkey,
        }}
        onClick={handleMutate}
      />
    );
  }
});

SaveTopic.displayName = 'SaveTopic';

export default SaveTopic;
