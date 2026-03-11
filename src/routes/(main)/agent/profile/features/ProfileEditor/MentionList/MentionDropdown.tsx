import { type MenuRenderProps } from '@lobehub/editor/es/plugins/slash/react/type';
import { Flexbox } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type ReactNode } from 'react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { type MentionListOption } from './types';

/**
 * Get cursor position from browser selection API
 */
const getCursorPosition = (): { x: number; y: number } | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  return {
    x: rect.left,
    y: rect.bottom,
  };
};

const MentionDropdown = memo<MenuRenderProps>(
  ({ activeKey, onSelect, open, options, setActiveKey }) => {
    const activeItemRef = useRef<HTMLDivElement>(null);
    const [position, setPosition] = useState<{ x: number; y: number } | null>(null);

    // Capture cursor position when menu opens
    useLayoutEffect(() => {
      if (open) {
        const pos = getCursorPosition();
        if (pos) {
          setPosition(pos);
        }
      }
    }, [open]);

    useEffect(() => {
      if (activeItemRef.current) {
        activeItemRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }, [activeKey]);

    if (!open || !options.length || !position) return null;

    return (
      <Flexbox
        style={{
          background: cssVar.colorBgElevated,
          border: `1px solid ${cssVar.colorBorderSecondary}`,
          borderRadius: 12,
          boxShadow: cssVar.boxShadowSecondary,
          left: position.x,
          maxHeight: 260,
          maxWidth: 400,
          minWidth: 150,
          overflow: 'hidden auto',
          position: 'fixed',
          top: position.y,
          zIndex: 9999,
        }}
      >
        {options.map((option) => {
          if ((option as any)?.type === 'divider') {
            return (
              <div
                key={`divider-${(option as any)?.key ?? 'divider'}`}
                style={{ borderTop: `1px solid ${cssVar.colorBorderSecondary}` }}
              />
            );
          }

          const item = option as MentionListOption;
          const isActive = activeKey === item.key;

          return (
            <Flexbox
              align="center"
              direction="horizontal"
              gap={8}
              key={String(item.key)}
              paddingBlock={8}
              paddingInline={12}
              ref={isActive ? activeItemRef : null}
              style={{
                background: isActive ? cssVar.colorFillSecondary : undefined,
                cursor: 'pointer',
              }}
              onMouseEnter={() => setActiveKey?.(String(item.key))}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect?.(item);
              }}
            >
              {item.icon && <Flexbox style={{ flex: 'none' }}>{item?.icon as ReactNode}</Flexbox>}
              <div
                style={{
                  color: cssVar.colorText,
                  fontSize: 14,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.label}
              </div>
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

MentionDropdown.displayName = 'MentionDropdown';

export default MentionDropdown;
