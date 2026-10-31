import { useToolRenderCapabilities } from '@lobechat/shared-tool-ui';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ArrowRight } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  icon: { color: cssVar.colorTextQuaternary },
  item: {
    paddingBlock: '4px',
    paddingInline: '12px',
    borderRadius: cssVar.borderRadius,
    transition: 'all 0.2s ease',
    background: { 'default': null, ':hover': cssVar.colorFillQuaternary },
  },
  path: { fontFamily: cssVar.fontFamilyCode, fontSize: '12px', wordBreak: 'break-all' },
});

interface MoveFileItemProps {
  newPath: string;
  oldPath: string;
}

const MoveFileItem = memo<MoveFileItemProps>(({ oldPath, newPath }) => {
  const { displayRelativePath } = useToolRenderCapabilities();
  const displayOldPath = displayRelativePath ? displayRelativePath(oldPath) : oldPath;
  const displayNewPath = displayRelativePath ? displayRelativePath(newPath) : newPath;

  return (
    <Flexbox
      horizontal
      align="center"
      className={stylex.props(styles.item).className}
      gap={8}
      width="100%"
    >
      <Flexbox flex={1}>
        <Text className={stylex.props(styles.path).className} type="secondary">
          {displayOldPath}
        </Text>
      </Flexbox>
      <Icon className={stylex.props(styles.icon).className} icon={ArrowRight} />
      <Flexbox flex={2}>
        <Text className={stylex.props(styles.path).className}>{displayNewPath}</Text>
      </Flexbox>
    </Flexbox>
  );
});

export default MoveFileItem;
