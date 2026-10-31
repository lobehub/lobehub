'use client';

import type { WidgetLayoutIconName, WidgetLayoutNode } from '@lobechat/types';
import { WIDGET_LAYOUT_LIMITS } from '@lobechat/types';
import { Icon } from '@lobehub/ui';
import type { StyleXStyles } from '@stylexjs/stylex';
import * as stylex from '@stylexjs/stylex';
import { type CSSProperties, Fragment, type ReactNode, useId } from 'react';

import { sparklinePoints } from '../../../utils/series';
import { WIDGET_LAYOUT_ICON_MAP } from './icons';
import {
  checkCondition,
  getPath,
  type LayoutScope,
  resolveColor,
  resolveNumber,
  resolveNumbers,
  resolveRaw,
  resolveText,
} from './resolve';

const styles = stylex.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    display: 'inline-flex',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: '18px',
    paddingInline: 7,
    whiteSpace: 'nowrap',
  },
  box: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
  },
  clamp: {
    WebkitBoxOrient: 'vertical',
    display: '-webkit-box',
    overflow: 'hidden',
  },
  divider: {
    alignSelf: 'stretch',
    backgroundColor: 'currentColor',
    flexShrink: 0,
    minHeight: 1,
    minWidth: 1,
    opacity: 0.15,
  },
  dot: {
    aspectRatio: '1',
    borderRadius: '50%',
    width: '100%',
  },
  // A wrapper that is not a box at all, so the node inside keeps its own display.
  hideNarrow: {
    display: {
      '@container (max-width: 279px)': 'none',
      'default': 'contents',
    },
  },
  hideShort: {
    display: {
      '@container (max-height: 179px)': 'none',
      'default': 'contents',
    },
  },
  image: {
    display: 'block',
    maxWidth: '100%',
  },
  nowrap: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  sizeDisplay: {
    fontSize: 'clamp(32px, min(22cqi, 34cqh), 88px)',
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.04em',
    lineHeight: 1,
  },
  sizeLg: { fontSize: 16, lineHeight: 1.4 },
  sizeMd: { fontSize: 14, lineHeight: 1.45 },
  sizeSm: { fontSize: 12, lineHeight: 1.45 },
  sizeXl: { fontSize: 20, letterSpacing: '-0.01em', lineHeight: 1.3 },
  sizeXs: { fontSize: 11, lineHeight: 1.4 },
  size2xl: {
    fontSize: 28,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.02em',
    lineHeight: 1.15,
  },
  spacer: {
    flexGrow: 1,
  },
  text: {
    margin: 0,
    minWidth: 0,
  },
  toneSecondary: { opacity: 0.72 },
  toneTertiary: { opacity: 0.5 },
  track: {
    backgroundColor: 'color-mix(in srgb, currentColor 16%, transparent)',
    borderRadius: 999,
    height: 6,
    overflow: 'hidden',
    width: '100%',
  },
  trackFill: {
    borderRadius: 999,
    height: '100%',
    transformOrigin: 'left',
    transitionDuration: '0.3s',
    transitionProperty: 'transform',
    width: '100%',
  },
});

const SIZE_STYLES = {
  '2xl': styles.size2xl,
  'display': styles.sizeDisplay,
  'lg': styles.sizeLg,
  'md': styles.sizeMd,
  'sm': styles.sizeSm,
  'xl': styles.sizeXl,
  'xs': styles.sizeXs,
};

const WEIGHTS = { bold: 700, medium: 500, regular: 400, semibold: 600 };

const TONE_COLORS: Record<string, string | undefined> = {
  error: resolveColor('error', {}),
  success: resolveColor('success', {}),
  warning: resolveColor('warning', {}),
};

const ALIGN = {
  baseline: 'baseline',
  center: 'center',
  end: 'flex-end',
  start: 'flex-start',
  stretch: 'stretch',
};

const JUSTIFY = {
  around: 'space-around',
  between: 'space-between',
  center: 'center',
  end: 'flex-end',
  start: 'flex-start',
};

const TEXT_ALIGN = { center: 'center', end: 'end', start: 'start' } as const;

/** StyleX classes plus the node's own inline values on one element. */
const props = (xstyle: StyleXStyles, style?: CSSProperties) => {
  const result = stylex.props(xstyle);
  return { className: result.className, style: { ...result.style, ...style } };
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

type Direction = 'row' | 'column';

interface LayoutNodeProps {
  depth?: number;
  node: WidgetLayoutNode;
  /** Main axis of the parent: in a column nothing shrinks below its content. */
  parentDirection?: Direction;
  scope: LayoutScope;
}

/**
 * One node of a widget layout. Unknown values never throw: a missing path
 * renders empty, an unknown icon or color falls back, so a script that drops
 * a field degrades the card instead of breaking it.
 */
const LayoutNode = (nodeProps: LayoutNodeProps): ReactNode => {
  const { node, scope, depth = 0 } = nodeProps;
  if (depth > WIDGET_LAYOUT_LIMITS.depth) return null;
  if (!checkCondition(node.visible, scope)) return null;
  if (!node.hideWhen) return <LayoutNodeBody {...nodeProps} />;

  // The container query sits on a wrapper so the node keeps its own display.
  return (
    <div {...stylex.props(node.hideWhen === 'narrow' ? styles.hideNarrow : styles.hideShort)}>
      <LayoutNodeBody {...nodeProps} />
    </div>
  );
};

const LayoutNodeBody = ({
  node,
  scope,
  depth = 0,
  parentDirection = 'column',
}: LayoutNodeProps): ReactNode => {
  const gradientId = useId();

  // Stacked rows keep their height (overflow clips at the card edge instead of
  // overlapping); items in a row may shrink so long text ellipsizes.
  const flex: CSSProperties =
    node.flex === undefined
      ? { flexShrink: parentDirection === 'column' ? 0 : 1 }
      : { flexBasis: 0, flexGrow: node.flex, flexShrink: 1 };
  const direction: Direction = 'direction' in node && node.direction === 'row' ? 'row' : 'column';
  const renderChildren = (children: WidgetLayoutNode[] = [], childScope = scope) =>
    children.map((child, index) => (
      <LayoutNode
        depth={depth + 1}
        key={index}
        node={child}
        parentDirection={direction}
        scope={childScope}
      />
    ));

  switch (node.type) {
    case 'stack': {
      return (
        <div
          data-layout-node={'stack'}
          {...props(styles.box, {
            ...flex,
            alignItems: node.align ? ALIGN[node.align] : undefined,
            flexDirection: node.direction === 'row' ? 'row' : 'column',
            flexWrap: node.wrap ? 'wrap' : undefined,
            gap: node.gap ?? 8,
            justifyContent: node.justify ? JUSTIFY[node.justify] : undefined,
            padding: node.padding,
          })}
        >
          {renderChildren(node.children)}
        </div>
      );
    }
    case 'grid': {
      return (
        <div
          data-layout-node={'grid'}
          {...props(styles.box, {
            ...flex,
            display: 'grid',
            gap: node.gap ?? 8,
            gridTemplateColumns: `repeat(${node.columns}, minmax(0, 1fr))`,
          })}
        >
          {renderChildren(node.children)}
        </div>
      );
    }
    case 'repeat': {
      const items = getPath(scope, node.items);
      if (!Array.isArray(items)) return null;
      const limit = Math.min(
        node.limit ?? WIDGET_LAYOUT_LIMITS.repeat,
        WIDGET_LAYOUT_LIMITS.repeat,
      );
      return (
        <div
          data-layout-node={'repeat'}
          {...props(styles.box, {
            ...flex,
            flexDirection: node.direction === 'row' ? 'row' : 'column',
            gap: node.gap ?? 8,
            justifyContent: node.justify ? JUSTIFY[node.justify] : undefined,
          })}
        >
          {items.slice(0, limit).map((item, index) => (
            <Fragment key={index}>
              <LayoutNode
                depth={depth + 1}
                node={node.template}
                parentDirection={direction}
                scope={{ ...scope, index, item }}
              />
            </Fragment>
          ))}
        </div>
      );
    }
    case 'text': {
      const text = resolveText(node.value, scope);
      const toneColor = node.tone ? TONE_COLORS[node.tone] : undefined;
      return (
        <div
          data-layout-node={'text'}
          {...props(
            [
              styles.text,
              SIZE_STYLES[node.size ?? 'md'],
              node.lines === undefined ? styles.nowrap : styles.clamp,
              node.tone === 'secondary' && styles.toneSecondary,
              node.tone === 'tertiary' && styles.toneTertiary,
            ],
            {
              ...flex,
              WebkitLineClamp: node.lines,
              color: toneColor,
              fontWeight:
                WEIGHTS[node.weight ?? (node.size === 'display' ? 'semibold' : 'regular')],
              textAlign: node.align ? TEXT_ALIGN[node.align] : undefined,
            },
          )}
        >
          {text}
        </div>
      );
    }
    case 'icon': {
      const icon = WIDGET_LAYOUT_ICON_MAP[resolveRaw(node.name, scope) as WidgetLayoutIconName];
      if (!icon) return null;
      return (
        <span
          data-layout-node={'icon'}
          {...props(styles.box, {
            ...flex,
            color: node.color === undefined ? undefined : resolveColor(node.color, scope),
            flexShrink: 0,
          })}
        >
          <Icon icon={icon} size={node.size ?? 20} />
        </span>
      );
    }
    case 'image': {
      const src = resolveText(node.src, scope);
      if (!src.startsWith('https://')) return null;
      return (
        <img
          alt={''}
          data-layout-node={'image'}
          loading={'lazy'}
          referrerPolicy={'no-referrer'}
          src={src}
          {...props(styles.image, {
            ...flex,
            borderRadius: node.radius ?? 8,
            height: node.height,
            objectFit: node.fit ?? 'cover',
            width: node.width,
          })}
        />
      );
    }
    case 'progress': {
      const min = resolveNumber(node.min, scope) ?? 0;
      const max = resolveNumber(node.max, scope) ?? 100;
      const value = resolveNumber(node.value, scope) ?? min;
      const ratio = max === min ? 0 : clamp01((value - min) / (max - min));
      return (
        <div data-layout-node={'progress'} {...props(styles.track, flex)}>
          <div
            {...props(styles.trackFill, {
              backgroundColor: resolveColor(node.color, scope),
              transform: `scaleX(${ratio})`,
            })}
          />
        </div>
      );
    }
    case 'ring': {
      const max = resolveNumber(node.max, scope) ?? 100;
      const ratio = max > 0 ? clamp01((resolveNumber(node.value, scope) ?? 0) / max) : 0;
      const size = node.size ?? 72;
      const stroke = Math.max(4, size / 10);
      const radius = (size - stroke) / 2;
      const circumference = 2 * Math.PI * radius;
      return (
        <div
          data-layout-node={'ring'}
          {...props(styles.box, {
            ...flex,
            alignItems: 'center',
            flexShrink: 0,
            height: size,
            justifyContent: 'center',
            position: 'relative',
            width: size,
          })}
        >
          <svg
            aria-hidden
            height={size}
            style={{ inset: 0, position: 'absolute', transform: 'rotate(-90deg)' }}
            width={size}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              fill={'none'}
              r={radius}
              stroke={'currentColor'}
              strokeOpacity={0.16}
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              fill={'none'}
              r={radius}
              stroke={resolveColor(node.color, scope)}
              strokeDasharray={`${circumference * ratio} ${circumference}`}
              strokeLinecap={'round'}
              strokeWidth={stroke}
            />
          </svg>
          <div
            {...props(styles.box, {
              alignItems: 'center',
              flexDirection: 'column',
              position: 'relative',
            })}
          >
            {renderChildren(node.children)}
          </div>
        </div>
      );
    }
    case 'dots': {
      const total = Math.min(Math.max(0, Math.round(resolveNumber(node.total, scope) ?? 0)), 400);
      const filled = Math.round(resolveNumber(node.value, scope) ?? 0);
      const color = resolveColor(node.color, scope);
      return (
        <div
          data-layout-node={'dots'}
          {...props(styles.box, {
            ...flex,
            display: 'grid',
            gap: 4,
            gridTemplateColumns: `repeat(${node.columns ?? 10}, minmax(0, 1fr))`,
          })}
        >
          {Array.from({ length: total }, (_, index) => (
            <span
              key={index}
              {...props(styles.dot, {
                backgroundColor:
                  index < filled ? color : 'color-mix(in srgb, currentColor 18%, transparent)',
              })}
            />
          ))}
        </div>
      );
    }
    case 'sparkline': {
      const values = resolveNumbers(node.values, scope, node.key);
      if (values.length < 2) return null;
      const color = resolveColor(node.color, scope);
      const width = 100;
      const height = 40;
      const kind = node.kind ?? 'line';
      let body: ReactNode;
      if (kind === 'bar') {
        const max = Math.max(...values.map(Math.abs), 1);
        const slot = width / values.length;
        body = values.map((value, index) => {
          const barHeight = Math.max(1, (Math.abs(value) / max) * (height - 2));
          return (
            <rect
              fill={color}
              height={barHeight}
              key={index}
              rx={Math.min(1.5, slot / 4)}
              width={slot * 0.62}
              x={index * slot + slot * 0.19}
              y={height - barHeight}
            />
          );
        });
      } else {
        const points = sparklinePoints(values, width, height);
        const line = points
          .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
          .join(' ');
        body = (
          <>
            {kind === 'area' && (
              <>
                <defs>
                  <linearGradient id={gradientId} x1={0} x2={0} y1={0} y2={1}>
                    <stop offset={'0%'} stopColor={color} stopOpacity={0.35} />
                    <stop offset={'100%'} stopColor={color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <path
                  d={`${line} L ${points.at(-1)!.x} ${height} L ${points[0].x} ${height} Z`}
                  fill={`url(#${gradientId})`}
                />
              </>
            )}
            <path
              d={line}
              fill={'none'}
              stroke={color}
              strokeLinecap={'round'}
              strokeLinejoin={'round'}
              strokeWidth={2}
              vectorEffect={'non-scaling-stroke'}
            />
          </>
        );
      }
      return (
        <svg
          aria-hidden
          data-layout-node={'sparkline'}
          preserveAspectRatio={'none'}
          viewBox={`0 0 ${width} ${height}`}
          {...props([], {
            ...flex,
            display: 'block',
            height: node.height ?? 40,
            overflow: 'visible',
            width: '100%',
          })}
        >
          {body}
        </svg>
      );
    }
    case 'badge': {
      const color = resolveColor(node.color, scope);
      return (
        <span
          data-layout-node={'badge'}
          {...props(styles.badge, {
            ...flex,
            backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
            color: node.color === undefined ? undefined : color,
          })}
        >
          {resolveText(node.value, scope)}
        </span>
      );
    }
    case 'divider': {
      return <div data-layout-node={'divider'} {...props(styles.divider, flex)} />;
    }
    case 'spacer': {
      return <div data-layout-node={'spacer'} {...props(styles.spacer, flex)} />;
    }
    default: {
      return null;
    }
  }
};

export default LayoutNode;
