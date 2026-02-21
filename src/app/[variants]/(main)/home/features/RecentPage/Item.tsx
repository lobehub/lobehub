'use client';

import { Avatar, Block, Center, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';

import Time from '@/app/[variants]/(main)/home/features/components/Time';
import { RECENT_BLOCK_SIZE } from '@/app/[variants]/(main)/home/features/const';
import { type FileListItem } from '@/types/files';
import markdownToTxt from '@/utils/markdownToTxt';

// Helper to extract title from markdown content
const extractTitle = (content: string): string | null => {
  if (!content) return null;

  // Find first markdown header (# title)
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
};

// Helper to extract preview text from note content
const getPreviewText = (item: FileListItem): string => {
  if (!item.content) return '';

  // Convert markdown to plain text
  let plainText = markdownToTxt(item.content.slice(0, 120));

  // Remove the title line if it exists
  const title = extractTitle(item.content);
  if (title) {
    plainText = plainText.replace(title, '').trim();
  }

  // Limit to first 200 characters for preview
  return plainText.slice(0, 200);
};

interface RecentPageItemProps {
  document: FileListItem;
}

const RecentPageItem = memo<RecentPageItemProps>(({ document }) => {
  const title = document.name || '';
  const previewText = getPreviewText(document);
  const emoji = document.metadata?.emoji;

  return (
    <Block
      clickable
      flex={'none'}
      height={RECENT_BLOCK_SIZE.PAGE.HEIGHT}
      variant={'outlined'}
      width={RECENT_BLOCK_SIZE.PAGE.WIDTH}
      style={{
        borderRadius: cssVar.borderRadiusLG,
        overflow: 'hidden',
      }}
    >
      <Center
        flex={'none'}
        height={44}
        style={{
          background: cssVar.colorFillTertiary,
          overflow: 'hidden',
        }}
      />
      <Flexbox flex={1} gap={6} justify={'space-between'} padding={12}>
        <Flexbox
          gap={6}
          style={{
            marginTop: -28,
          }}
        >
          {emoji ? (
            <Avatar avatar={emoji} shape={'square'} size={30} />
          ) : (
            <Center flex={'none'} height={30} style={{ marginLeft: -4 }} width={30}>
              <Icon color={cssVar.colorTextDescription} icon={FileTextIcon} size={24} />
            </Center>
          )}
          <Text ellipsis={{ rows: 2 }} style={{ fontSize: 14, lineHeight: 1.4 }} weight={500}>
            {title}
          </Text>
          {previewText && (
            <Text
              ellipsis={{ rows: 2 }}
              fontSize={13}
              style={{ lineHeight: 1.5 }}
              type={'secondary'}
            >
              {previewText}
            </Text>
          )}
        </Flexbox>
        <Time date={document.updatedAt} />
      </Flexbox>
    </Block>
  );
});

export default RecentPageItem;
