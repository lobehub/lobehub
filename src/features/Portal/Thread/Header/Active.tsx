import { resolveCCSubagentType } from '@lobechat/builtin-tool-claude-code/client';
import { Flexbox, Icon, Tag, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import isEqual from 'fast-deep-equal';
import { ListTree } from 'lucide-react';
import { memo } from 'react';

import BubblesLoading from '@/components/BubblesLoading';
import { LOADING_FLAT } from '@/const/message';
import { useChatStore } from '@/store/chat';
import { portalThreadSelectors } from '@/store/chat/selectors';
import { oneLineEllipsis } from '@/styles';

const Active = memo(() => {
  const currentThread = useChatStore(portalThreadSelectors.portalCurrentThread, isEqual);

  if (!currentThread) return null;

  // Subagent spawn → show the specific template (e.g. "Explore",
  // "General purpose") as a chip next to the title. Sidebar only marks
  // "Subagent" generically; the header is where the detail belongs.
  const subagentTypeInfo = resolveCCSubagentType(currentThread.metadata?.subagentType);

  return (
    <Flexbox horizontal align={'center'} gap={8} style={{ marginInlineStart: 4 }}>
      <Icon color={cssVar.colorTextSecondary} icon={ListTree} size={18} />
      <Text
        className={oneLineEllipsis}
        ellipsis={true}
        style={{ color: cssVar.colorTextSecondary, fontSize: 14 }}
      >
        {currentThread.title === LOADING_FLAT ? (
          <Flexbox flex={1} height={30} justify={'center'}>
            <BubblesLoading />
          </Flexbox>
        ) : (
          currentThread.title
        )}
      </Text>
      {subagentTypeInfo && (
        <Tag
          icon={<Icon icon={subagentTypeInfo.icon} />}
          size={'small'}
          style={{
            color: cssVar.colorTextDescription,
            flexShrink: 0,
            fontSize: 11,
          }}
        >
          {subagentTypeInfo.label}
        </Tag>
      )}
    </Flexbox>
  );
});

export default Active;
