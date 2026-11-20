import type { ArtboardPublishSnapshot } from '@lobechat/types';
import { ConfigProvider, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { motion } from 'motion/react';
import { useMemo } from 'react';

import Outline from '@/features/Artboard/Board/Outline';
import { BoardProvider } from '@/features/Artboard/BoardContext';
import BoardFrame from '@/features/Artboard/Canvas/BoardFrame';
import { boardFileUrl } from '@/features/Artboard/model';
import { useArtboardStore } from '@/features/Artboard/store';
import Viewport from '@/features/Artboard/Viewport';
import {
  type BoardCapabilities,
  BoardCapabilitiesProvider,
} from '@/features/Artboard/Viewport/capabilities';

import { snapshotToBoard } from './snapshot';

const styles = stylex.create({
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
  const { artboard, fileBaseUrl } = useMemo(() => snapshotToBoard(snapshot), [snapshot]);
  const capabilities = useMemo<BoardCapabilities>(
    () => ({
      renderCanvas: (board) => {
        const src = boardFileUrl({ fileBaseUrl }, board);
        return src ? <BoardFrame src={src} title={board.title} /> : null;
      },
    }),
    [fileBaseUrl],
  );
  // Seeded by `initViewerStore`; the viewport keeps boards clear of it only while it is open.
  const outlineOpen = useArtboardStore((s) => s.outlineOpen);

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
          <BoardProvider artboard={artboard} fileBaseUrl={fileBaseUrl}>
            <BoardCapabilitiesProvider value={capabilities}>
              <Viewport />
              {outlineOpen && <Outline />}
            </BoardCapabilitiesProvider>
          </BoardProvider>
        </div>
      </Flexbox>
    </ConfigProvider>
  );
};

export default App;
