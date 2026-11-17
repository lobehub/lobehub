import type { ArtboardPublishSnapshot } from '@lobechat/types';
import { ConfigProvider, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { motion } from 'motion/react';
import { useMemo } from 'react';

import Outline from '@/features/Artboard/Board/Outline';
import { BoardProvider } from '@/features/Artboard/BoardContext';
import Viewport from '@/features/Artboard/Viewport';
import {
  type BoardCapabilities,
  BoardCapabilitiesProvider,
} from '@/features/Artboard/Viewport/capabilities';

import { snapshotToBoard } from './snapshot';

const styles = stylex.create({
  frame: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    height: '100%',
    width: '100%',
  },
  header: {
    borderBlockEndColor: cssVar.colorBorderSecondary,
    borderBlockEndStyle: 'solid',
    borderBlockEndWidth: 1,
    flex: 'none',
    paddingBlock: 10,
    paddingInline: 16,
  },
  root: {
    backgroundColor: cssVar.colorBgLayout,
    height: '100dvh',
    width: '100%',
  },
  stage: {
    flex: '1',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
  },
});

const App = ({ snapshot }: { snapshot: ArtboardPublishSnapshot }) => {
  const { artboard, canvasSrc, imageUrls } = useMemo(() => snapshotToBoard(snapshot), [snapshot]);
  const capabilities = useMemo<BoardCapabilities>(
    () => ({
      renderCanvas: (board) =>
        canvasSrc[board.id] ? (
          <iframe
            loading={'lazy'}
            referrerPolicy={'no-referrer'}
            sandbox={'allow-scripts'}
            src={canvasSrc[board.id]}
            title={board.title}
            {...stylex.props(styles.frame)}
          />
        ) : null,
    }),
    [canvasSrc],
  );
  const showOutline = snapshot.pages.length > 1 || snapshot.groups.length > 0;

  return (
    <ConfigProvider motion={motion}>
      <Flexbox {...stylex.props(styles.root)}>
        <Flexbox gap={2} {...stylex.props(styles.header)}>
          <Text strong>{snapshot.title}</Text>
          {snapshot.description && (
            <Text ellipsis style={{ fontSize: 12 }} type={'secondary'}>
              {snapshot.description}
            </Text>
          )}
        </Flexbox>
        <div {...stylex.props(styles.stage)}>
          <BoardProvider artboard={artboard} imageUrls={imageUrls}>
            <BoardCapabilitiesProvider value={capabilities}>
              <Viewport />
              {showOutline && <Outline />}
            </BoardCapabilitiesProvider>
          </BoardProvider>
        </div>
      </Flexbox>
    </ConfigProvider>
  );
};

export default App;
