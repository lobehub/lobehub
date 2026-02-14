'use client';

import { Flexbox, Skeleton } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { memo } from 'react';

const PanelContentSkeleton = memo(() => {
  return (
    <Flexbox gap={2} style={{ minWidth: 300 }}>
      {/* UserInfo + DataStatistics area */}
      <Flexbox gap={8} style={{ padding: '12px 16px' }}>
        <Flexbox horizontal align="center" gap={12}>
          <Skeleton.Button
            size="small"
            style={{
              borderRadius: cssVar.borderRadius,
              height: 40,
              minWidth: 40,
              width: 40,
            }}
          />
          <Flexbox flex={1} gap={4}>
            <Skeleton.Button
              active
              block
              size="small"
              style={{
                borderRadius: cssVar.borderRadius,
                height: 16,
                maxWidth: 120,
                opacity: 0.6,
              }}
            />
            <Skeleton.Button
              active
              block
              size="small"
              style={{
                borderRadius: cssVar.borderRadius,
                height: 12,
                maxWidth: 80,
                opacity: 0.4,
              }}
            />
          </Flexbox>
        </Flexbox>
        <Flexbox horizontal gap={4}>
          {[1, 2, 3].map((i) => (
            <Skeleton.Button
              active
              key={i}
              size="small"
              style={{
                borderRadius: cssVar.borderRadius,
                flex: 1,
                height: 36,
                opacity: 0.5,
              }}
            />
          ))}
        </Flexbox>
      </Flexbox>

      {/* Menu items */}
      {[1, 2].map((row) => (
        <Flexbox gap={2} key={row} style={{ padding: '0 8px' }}>
          {[1, 2].map((i) => (
            <Flexbox horizontal align="center" gap={8} key={i} style={{ height: 36 }}>
              <Skeleton.Button
                size="small"
                style={{
                  borderRadius: cssVar.borderRadius,
                  height: 20,
                  minWidth: 20,
                  width: 20,
                }}
              />
              <Skeleton.Button
                active
                block
                size="small"
                style={{
                  borderRadius: cssVar.borderRadius,
                  height: 14,
                  opacity: 0.5,
                }}
              />
            </Flexbox>
          ))}
        </Flexbox>
      ))}

      {/* Footer: BrandWatermark + LangButton */}
      <Flexbox
        horizontal
        align="center"
        gap={4}
        justify="space-between"
        style={{ padding: '6px 8px 6px 16px' }}
      >
        <Skeleton.Button
          active
          size="small"
          style={{
            borderRadius: cssVar.borderRadius,
            height: 20,
            width: 80,
            opacity: 0.4,
          }}
        />
        <Skeleton.Button
          size="small"
          style={{
            borderRadius: cssVar.borderRadius,
            height: 28,
            minWidth: 28,
            width: 28,
          }}
        />
      </Flexbox>
    </Flexbox>
  );
});

PanelContentSkeleton.displayName = 'PanelContentSkeleton';

export default PanelContentSkeleton;
