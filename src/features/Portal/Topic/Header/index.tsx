import { ActionIcon } from '@lobehub/ui/base-ui';
import { cssVar } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo } from 'react';

import NavHeader from '@/features/NavHeader';
import { useChatStore } from '@/store/chat';

import Title from './Title';

const Header = memo(() => {
  const closeTopicPortal = useChatStore((s) => s.closeTopicPortal);

  return (
    <NavHeader
      left={<Title />}
      paddingBlock={6}
      paddingInline={8}
      right={<ActionIcon icon={XIcon} size={'small'} onClick={closeTopicPortal} />}
      showTogglePanelButton={false}
      style={{
        borderBottom: `1px solid ${cssVar.colorBorderSecondary}`,
      }}
    />
  );
});

export default Header;
