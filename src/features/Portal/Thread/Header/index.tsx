import { ActionIcon } from '@lobehub/ui';
import { ArrowLeftRight } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import PortalHeader from '@/features/Portal/components/Header';
import { useChatStore } from '@/store/chat';
import { useHeaderActionSize } from '@/styles/density';

import Title from './Title';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const headerActionSize = useHeaderActionSize(true);
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
            size={headerActionSize}
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
