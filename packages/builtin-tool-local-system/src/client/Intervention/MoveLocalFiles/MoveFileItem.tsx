import { Flexbox, Icon, Text } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';

import { useElectronStore } from '@/store/electron';
import { desktopStateSelectors } from '@/store/electron/selectors';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  item: css`
    padding-block: 4px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};
    transition: all 0.2s ease;

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  path: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    word-break: break-all;
  `,
}));

interface MoveFileItemProps {
  newPath: string;
  oldPath: string;
}

const MoveFileItem = memo<MoveFileItemProps>(({ oldPath, newPath }) => {
  const displayOldPath = useElectronStore(desktopStateSelectors.displayRelativePath(oldPath));
  const displayNewPath = useElectronStore(desktopStateSelectors.displayRelativePath(newPath));

  return (
    <Flexbox horizontal align="center" className={styles.item} gap={8} width="100%">
      <Flexbox flex={1}>
        <Text className={styles.path} type="secondary">
          {displayOldPath}
        </Text>
      </Flexbox>
      <Icon className={styles.icon} icon={ArrowRight} />
      <Flexbox flex={2}>
        <Text className={styles.path}>{displayNewPath}</Text>
      </Flexbox>
    </Flexbox>
  );
});

export default MoveFileItem;
