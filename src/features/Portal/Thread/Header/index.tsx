import { DESKTOP_HEADER_ICON_SMALL_SIZE } from '@lobechat/const';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { ArrowLeftRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PortalHeader from '@/features/Portal/components/Header';
import { useChatStore } from '@/store/chat';

import Title from './Title';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { t } = useTranslation('thread');
  const [portalThreadId, closeThreadPortal, switchThread] = useChatStore((s) => [
    s.portalThreadId,
    s.closeThreadPortal,
    s.switchThread,
  ]);

  return (
    <PortalHeader
      title={<Title />}
      rightExtra={
        portalThreadId && (
          <ActionIcon
            aria-label={t('portal.openInMain')}
            icon={ArrowLeftRight}
            size={DESKTOP_HEADER_ICON_SMALL_SIZE}
            title={t('portal.openInMain')}
            onClick={() => {
              switchThread(portalThreadId);
              closeThreadPortal();
            }}
          />
        )
      }
      onClose={onClose ?? closeThreadPortal}
    />
  );
});

Header.displayName = 'PortalThreadHeader';

export default Header;
