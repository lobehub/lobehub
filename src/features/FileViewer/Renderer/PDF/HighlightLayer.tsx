import { type FC } from 'react';
import { memo } from 'react';

import { useFileStore } from '@/store/file';
import { type ChunkMetadata, type Coordinates, type FileChunk } from '@/types/chunk';

interface HighlightRectProps {
  coordinates: Coordinates;
  highlight: boolean;
}

const HighlightRect: FC<HighlightRectProps> = ({ coordinates, highlight }) => {
  const { points } = coordinates;

  // 假设points数组包含矩形的四个顶点坐标
  const [topLeft, topRight, bottomRight, bottomLeft] = points;

  // 计算矩形的属性
  const minX = Math.min(topLeft[0], topRight[0], bottomRight[0], bottomLeft[0]);
  const minY = Math.min(topLeft[1], topRight[1], bottomRight[1], bottomLeft[1]);
  const width = Math.max(topLeft[0], topRight[0], bottomRight[0], bottomLeft[0]) - minX;
  const height = Math.max(topLeft[1], topRight[1], bottomRight[1], bottomLeft[1]) - minY;

  return (
    <rect
      fill={highlight ? 'rgba(255, 255, 0, 0.5)' : 'rgba(255, 255, 0, 0.3)'}
      height={height}
      stroke="rgba(255, 255, 0, 0.7)"
      strokeWidth="1"
      width={width}
      x={minX}
      y={minY}
    />
  );
};

interface HighlightLayerProps {
  dataSource: FileChunk[];
  pageNumber: number;
  width: number;
}

const HighlightLayer = memo<HighlightLayerProps>(({ dataSource, pageNumber, width }) => {
  const chunks = dataSource
    .filter((chunk) => chunk.pageNumber && chunk.pageNumber === pageNumber)
    .filter(Boolean);
  const highlightChunkIds = useFileStore((s) => s.highlightChunkIds);

  const isExist = chunks.length > 0;

  if (!isExist) return null;

  const metadata = chunks[0].metadata as ChunkMetadata;
  if (!metadata.coordinates) return;

  const { layout_width, layout_height } = metadata.coordinates;

  const height = metadata.coordinates.layout_height * (width / metadata.coordinates.layout_width);

  return (
    <svg
      height={height}
      style={{ left: 0, position: 'absolute', top: 0, zIndex: 100 }}
      viewBox={`0 0 ${layout_width} ${layout_height}`}
      width={width}
    >
      {chunks.map(
        (chunk, index) =>
          chunk.metadata && (
            <HighlightRect
              coordinates={chunk.metadata.coordinates}
              highlight={highlightChunkIds.includes(chunk.id)}
              key={index}
            />
          ),
      )}
      s
    </svg>
  );
});

export default HighlightLayer;
