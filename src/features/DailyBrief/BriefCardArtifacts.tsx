import type { BriefArtifactDocument, BriefArtifacts } from '@lobechat/types';
import { Block, Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ChevronRightIcon, FileTextIcon } from 'lucide-react';
import { memo } from 'react';

import { useDocumentStore } from '@/store/document';

const styles = createStaticStyles(({ css, cssVar }) => ({
  iconWrap: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    background: ${cssVar.colorBgContainer};
  `,
}));

const BriefArtifactCard = memo<{ doc: BriefArtifactDocument }>(({ doc }) => {
  const openDocumentPreview = useDocumentStore((s) => s.openDocumentPreview);
  const title = doc.title || 'Untitled';

  return (
    <Block
      clickable
      horizontal
      align={'center'}
      gap={12}
      paddingBlock={10}
      paddingInline={12}
      variant={'filled'}
      onClick={() => openDocumentPreview(doc.id)}
    >
      <div className={styles.iconWrap}>
        <Icon
          color={cssVar.colorTextSecondary}
          icon={FileTextIcon}
          size={{ size: 20, strokeWidth: 1.5 }}
        />
      </div>
      <Text ellipsis style={{ flex: 1, minWidth: 0 }} weight={500}>
        {title}
      </Text>
      <Icon
        color={cssVar.colorTextQuaternary}
        icon={ChevronRightIcon}
        size={16}
        style={{ flexShrink: 0 }}
      />
    </Block>
  );
});

interface BriefCardArtifactsProps {
  artifacts?: BriefArtifacts | null;
}

const BriefCardArtifacts = memo<BriefCardArtifactsProps>(({ artifacts }) => {
  const docs = artifacts?.documents;
  if (!docs?.length) return null;

  return (
    <Flexbox gap={8}>
      {docs.map((doc) => (
        <BriefArtifactCard doc={doc} key={doc.id} />
      ))}
    </Flexbox>
  );
});

export default BriefCardArtifacts;
