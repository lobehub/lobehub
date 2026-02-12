'use client';

import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { CornerRightUp } from 'lucide-react';
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
    // Use the editor instance to set markdown content directly
    mainInputEditor?.instance?.setDocument('markdown', prompt);
    mainInputEditor?.focus();
  }, [prompt, mainInputEditor]);

  return (
    <Block
      clickable
      variant={'outlined'}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        cursor: 'pointer',
      }}
      onClick={handleClick}
    >
      <Flexbox gap={4} paddingBlock={12} paddingInline={14}>
        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'}>
          <Text ellipsis fontSize={14} style={{ fontWeight: 500 }}>
            {title}
          </Text>
          <Icon color={cssVar.colorTextQuaternary} icon={CornerRightUp} size={14} />
        </Flexbox>
        <Text color={cssVar.colorTextTertiary} ellipsis={{ rows: 2 }} fontSize={12}>
          {description}
        </Text>
      </Flexbox>
    </Block>
  );
});

export default Item;
