import type { CollectionWorkItem } from '@lobechat/types';
import { Image, PreviewGroup, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';

import { downloadPreviewImage } from '@/features/Conversation/Messages/components/downloadPreviewImage';

const styles = stylex.create({
  caption: {
    color: cssVar.colorTextSecondary,
    fontSize: 12,
    lineHeight: 1.5,
  },
  grid: {
    display: 'grid',
    // Keep in step with COLLECTION_GRID_GAP / COLLECTION_TILE_SIZE in ./layout; StyleX needs literals.
    gap: 12,
    // auto-fit collapses unused tracks, so fewer images than columns stretch to fill the row.
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 0,
  },
});

interface CollectionGridProps {
  items: CollectionWorkItem[];
}

/**
 * Square tiles of every collection image. One preview group lets the viewer step
 * through the collection; its download action saves `/f/<id>` images under their
 * stored names.
 */
const CollectionGrid = ({ items }: CollectionGridProps) => (
  <PreviewGroup preview={{ onDownload: downloadPreviewImage }}>
    <div {...stylex.props(styles.grid)}>
      {items.map((item) => (
        <div key={item.fileId} {...stylex.props(styles.tile)}>
          <Image
            alt={item.caption ?? ''}
            objectFit={'cover'}
            src={item.url}
            // The ratio goes on the <img>: on the root it squares the frame while the
            // image keeps its own height, leaving an empty strip under landscape shots.
            styles={{ image: { aspectRatio: 1 } }}
            width={'100%'}
          />
          {item.caption && (
            <Text ellipsis={{ tooltip: true }} {...stylex.props(styles.caption)}>
              {item.caption}
            </Text>
          )}
        </div>
      ))}
    </div>
  </PreviewGroup>
);

export default CollectionGrid;
