import { ActionIcon, Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { ArrowLeftRight, XIcon } from 'lucide-react';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';

import Title from './Title';

const Header = memo(() => {
  const [hasPortal, portalThreadId, closeThreadPortal, switchThread] = useChatStore((s) => [
    !!s.portalThreadId,
    s.portalThreadId,
    s.closeThreadPortal,
    s.switchThread,
  ]);

  return (
    <NavHeader
      left={<Title />}
      paddingBlock={6}
      paddingInline={8}
      showTogglePanelButton={false}
      right={
        <Flexbox horizontal gap={4}>
          {hasPortal && (
            <ActionIcon
              icon={ArrowLeftRight}
              size={'small'}
              onClick={() => {
                if (!portalThreadId) return;

                switchThread(portalThreadId);
                closeThreadPortal();
              }}
            />
          )}
          <ActionIcon icon={XIcon} size={'small'} onClick={closeThreadPortal} />
        </Flexbox>
      }
      style={{
        borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
      }}
    />
  );
});

export default Header;
