'use client';

import { BRANDING_NAME } from '@lobechat/business-const';
import { ActionIcon, Flexbox, FluentEmoji, SideNav } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { XIcon } from 'lucide-react';
import { memo, type ReactNode, useEffect, useState } from 'react';
import { Rnd } from 'react-rnd';

import { isDesktop } from '@/const/version';
import { usePathname } from '@/libs/next/navigation';

// 定义样式
const styles = createStaticStyles(({ css }) => {
  return {
    collapsed: css`
      pointer-events: none;
      transform: scale(0.8);
      opacity: 0;
    `,
    expanded: css`
      pointer-events: auto;
      transform: scale(1);
      opacity: 1;
    `,
    debugButton: css`
      cursor: default;
      user-select: none;

      position: fixed;
      inset-block-end: 9px;
      inset-inline-end: 9px;

      padding-block: 1px;
      padding-inline: 8px;
      border-radius: 12px;

      font-size: 8px;
      color: ${cssVar.colorBgContainer};

      background-color: ${cssVar.colorText};
    `,
    header: css`
      cursor: move;
      user-select: none;

      padding-block: 8px;
      padding-inline: 16px;
      border-block-end: 1px solid ${cssVar.colorBorderSecondary};

      color: ${cssVar.colorText};

      background: ${cssVar.colorFillAlter};
    `,
    panel: css`
      position: fixed;
      z-index: 1000;

      overflow: hidden;
      display: flex;

      border: 1px solid ${cssVar.colorBorderSecondary};
      border-radius: 12px;

      background: ${cssVar.colorBgContainer};
      box-shadow: ${cssVar.boxShadow};

      transition: opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
    `,
  };
});

const minWidth = 800;
const minHeight = 600;

interface CollapsibleFloatPanelProps {
  items: { children: ReactNode; icon: ReactNode; key: string }[];
}

const CollapsibleFloatPanel = memo<CollapsibleFloatPanelProps>(({ items }) => {
  const [tab, setTab] = useState<string>(items[0].key);

  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [size, setSize] = useState({ height: minHeight, width: minWidth });

  const pathname = usePathname();
  useEffect(() => {
    try {
      const localStoragePosition = localStorage.getItem('debug-panel-position');
      if (localStoragePosition && JSON.parse(localStoragePosition)) {
        setPosition(JSON.parse(localStoragePosition));
      }
    } catch {
      /* empty */
    }

    try {
      const localStorageSize = localStorage.getItem('debug-panel-size');
      if (localStorageSize && JSON.parse(localStorageSize)) {
        setSize(JSON.parse(localStorageSize));
      }
    } catch {
      /* empty */
    }
  }, []);

  return (
    <>
      {
        // desktop devtools 下隐藏
        pathname !== '/desktop/devtools' && isDesktop && (
          <div
            className={styles.debugButton}
            onClick={async () => {
              if (isDesktop) {
                const { electronDevtoolsService } = await import('@/services/electron/devtools');

                await electronDevtoolsService.openDevtools();

                return;
              }
              setIsExpanded(!isExpanded);
            }}
          >
            DEV
          </div>
        )
      }
      {isExpanded && (
        <Rnd
          bounds="window"
          className={cx(styles.panel, isExpanded ? styles.expanded : styles.collapsed)}
          dragHandleClassName="panel-drag-handle"
          minHeight={minHeight}
          minWidth={minWidth}
          position={position}
          size={size}
          onDragStop={(e, d) => {
            setPosition({ x: d.x, y: d.y });
          }}
          onResizeStop={(e, direction, ref, delta, position) => {
            setSize({
              height: Number(ref.style.height),
              width: Number(ref.style.width),
            });
            setPosition(position);
          }}
        >
          <Flexbox
            horizontal
            height={'100%'}
            style={{ overflow: 'hidden', position: 'relative' }}
            width={'100%'}
          >
            <SideNav
              avatar={<FluentEmoji emoji={'🧰'} size={24} />}
              bottomActions={[]}
              style={{
                paddingBlock: 12,
                width: 48,
              }}
              topActions={items.map((item) => (
                <ActionIcon
                  active={tab === item.key}
                  icon={item.icon}
                  key={item.key}
                  title={item.key}
                  tooltipProps={{
                    placement: 'right',
                  }}
                  onClick={() => setTab(item.key)}
                />
              ))}
            />
            <Flexbox
              height={'100%'}
              style={{ overflow: 'hidden', position: 'relative' }}
              width={'100%'}
            >
              <Flexbox
                horizontal
                align={'center'}
                className={cx('panel-drag-handle', styles.header)}
                justify={'space-between'}
              >
                <Flexbox horizontal align={'baseline'} gap={6}>
                  <b>{BRANDING_NAME} Dev Tools</b>
                  <span style={{ color: cssVar.colorTextDescription }}>/</span>
                  <span style={{ color: cssVar.colorTextDescription }}>{tab}</span>
                </Flexbox>
                <ActionIcon icon={XIcon} onClick={() => setIsExpanded(false)} />
              </Flexbox>
              {items.map((item) => (
                <Flexbox
                  flex={1}
                  height={'100%'}
                  key={item.key}
                  style={{
                    display: tab === item.key ? 'flex' : 'none',
                    overflow: 'hidden',
                  }}
                >
                  {item.children}
                </Flexbox>
              ))}
            </Flexbox>
          </Flexbox>
        </Rnd>
      )}
    </>
  );
});

export default CollapsibleFloatPanel;
