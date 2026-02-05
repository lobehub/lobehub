'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo, useCallback } from 'react';

import { useChatStore } from '@/store/chat';

interface ItemProps {
  description: string;
  prompt: string;
  title: string;
}

const Item = memo<ItemProps>(({ title, description, prompt }) => {
  const mainInputEditor = useChatStore((s) => s.mainInputEditor);

  const handleClick = useCallback(() => {
    mainInputEditor?.instance?.setDocument('markdown', prompt);
    mainInputEditor?.focus();
  }, [prompt, mainInputEditor]);

  return (
    <Block
      clickable
      onClick={handleClick}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        cursor: 'pointer',
      }}
      variant={'outlined'}
    >
      <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
        <Text ellipsis fontSize={14} style={{ fontWeight: 500 }}>
          {title}
        </Text>
        <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
          {description}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default Item;
