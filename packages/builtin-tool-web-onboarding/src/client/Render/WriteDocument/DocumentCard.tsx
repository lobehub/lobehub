'use client';

import { CopyButton, Flexbox, Markdown, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    width: '100%',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: '16px',
    background: cssVar.colorBgContainer,
  },
  content: { paddingInline: '16px', fontSize: '14px' },
  header: {
    paddingBlock: '10px',
    paddingInline: '12px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  icon: { color: cssVar.colorPrimary },
  title: {
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: '1',
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

interface DocumentCardProps {
  content: string;
  title: string;
}

const DocumentCard = memo<DocumentCardProps>(({ content, title }) => (
  <Flexbox className={stylex.props(styles.container).className}>
    <Flexbox horizontal align={'center'} className={stylex.props(styles.header).className} gap={8}>
      <FileTextIcon className={stylex.props(styles.icon).className} size={16} />
      <Flexbox flex={1}>
        <div {...stylex.props(styles.title)}>{title}</div>
      </Flexbox>
      <TooltipGroup>
        <CopyButton content={content} size={'small'} />
      </TooltipGroup>
    </Flexbox>
    <ScrollShadow
      className={stylex.props(styles.content).className}
      offset={12}
      size={12}
      style={{ maxHeight: 400 }}
    >
      <Markdown style={{ overflow: 'unset', paddingBottom: 16 }} variant={'chat'}>
        {content}
      </Markdown>
    </ScrollShadow>
  </Flexbox>
));

export default DocumentCard;
