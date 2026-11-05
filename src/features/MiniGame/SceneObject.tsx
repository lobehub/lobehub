'use client';

import type { GameObject } from '@lobechat/builtin-tool-mini-game';
import * as stylex from '@stylexjs/stylex';
import { memo, type ReactNode } from 'react';

import { sx } from '@/styles/sx';

import { ART, TILE } from './palette';

const swim = stylex.keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' },
});

const glow = stylex.keyframes({
  '0%': { opacity: 0.45 },
  '50%': { opacity: 0.8 },
  '100%': { opacity: 0.45 },
});

const styles = stylex.create({
  fishOrbit: {
    animationDuration: '9s',
    animationIterationCount: 'infinite',
    animationName: swim,
    animationTimingFunction: 'linear',
    transformBox: 'view-box',
  },
  fishOrbitReverse: {
    animationDirection: 'reverse',
    animationDuration: '13s',
  },
  glow: {
    animationDuration: '3s',
    animationIterationCount: 'infinite',
    animationName: glow,
  },
  target: {
    cursor: 'pointer',
    outline: 'none',
  },
});

export interface ObjectBox {
  h: number;
  w: number;
  x: number;
  y: number;
}

export const getObjectBox = (object: GameObject): ObjectBox => {
  const xs = object.footprint.map((p) => p.x);
  const ys = object.footprint.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    h: (Math.max(...ys) - y + 1) * TILE,
    w: (Math.max(...xs) - x + 1) * TILE,
    x: x * TILE,
    y: y * TILE,
  };
};

const Fish = ({ cx, cy, r, reverse }: { cx: number; cy: number; r: number; reverse?: boolean }) => (
  <g
    {...sx([styles.fishOrbit, reverse && styles.fishOrbitReverse], undefined, {
      transformOrigin: `${cx}px ${cy}px`,
    })}
  >
    <ellipse cx={cx + r} cy={cy} fill={ART.fish} rx={6} ry={3} />
    <path d={`M${cx + r - 6} ${cy} l-4 -3 v6 z`} fill={ART.fishFin} />
  </g>
);

const drawObject = (object: GameObject, { h, w, x, y }: ObjectBox): ReactNode => {
  switch (object.kind) {
    case 'house': {
      return (
        <>
          <rect
            fill={ART.wall}
            height={h * 0.62}
            stroke={ART.outline}
            width={w - 8}
            x={x + 4}
            y={y + h * 0.38}
          />
          <path
            d={`M${x} ${y + h * 0.42} L${x + w / 2} ${y + 2} L${x + w} ${y + h * 0.42} Z`}
            fill={ART.roof}
            stroke={ART.roofDark}
            strokeWidth={2}
          />
          <rect fill={ART.door} height={h * 0.34} width={14} x={x + w / 2 - 7} y={y + h * 0.66} />
          <rect
            fill={ART.windowLight}
            height={12}
            stroke={ART.outline}
            width={14}
            x={x + 12}
            y={y + h * 0.52}
          />
          <rect
            fill={ART.windowLight}
            height={12}
            stroke={ART.outline}
            width={14}
            x={x + w - 26}
            y={y + h * 0.52}
          />
        </>
      );
    }
    case 'garden': {
      const heads = [0.2, 0.5, 0.8].flatMap((fx) =>
        [0.3, 0.72].map((fy) => ({ cx: x + w * fx, cy: y + h * fy })),
      );
      return (
        <>
          <rect
            fill={ART.soil}
            height={h - 6}
            rx={4}
            stroke={ART.soilDark}
            width={w - 6}
            x={x + 3}
            y={y + 3}
          />
          {heads.map((p) => (
            <g key={`${p.cx}-${p.cy}`}>
              <circle cx={p.cx} cy={p.cy} fill={ART.cabbageDark} r={8} />
              <circle cx={p.cx} cy={p.cy - 1} fill={ART.cabbage} r={5} />
            </g>
          ))}
        </>
      );
    }
    case 'well': {
      return (
        <>
          <circle
            cx={x + w / 2}
            cy={y + h / 2 + 2}
            fill={ART.stone}
            r={13}
            stroke={ART.stoneDark}
            strokeWidth={3}
          />
          <circle cx={x + w / 2} cy={y + h / 2 + 2} fill={ART.water} r={7} />
          <rect fill={ART.trunk} height={18} width={3} x={x + 4} y={y - 6} />
          <rect fill={ART.trunk} height={18} width={3} x={x + w - 7} y={y - 6} />
          <rect fill={ART.roof} height={6} width={w} x={x} y={y - 9} />
        </>
      );
    }
    case 'bench': {
      return (
        <>
          <rect fill={ART.benchDark} height={10} width={4} x={x + 6} y={y + 18} />
          <rect fill={ART.benchDark} height={10} width={4} x={x + w - 10} y={y + 18} />
          <rect
            fill={ART.benchLight}
            height={8}
            rx={2}
            stroke={ART.benchDark}
            width={w - 4}
            x={x + 2}
            y={y + 12}
          />
          <rect
            fill={ART.benchLight}
            height={6}
            rx={2}
            stroke={ART.benchDark}
            width={w - 4}
            x={x + 2}
            y={y + 2}
          />
        </>
      );
    }
    case 'lamp': {
      return (
        <>
          <circle
            cx={x + w / 2}
            cy={y + 4}
            fill={ART.lampGlow}
            r={16}
            {...stylex.props(styles.glow)}
          />
          <rect fill={ART.lampPost} height={26} width={4} x={x + w / 2 - 2} y={y + 6} />
          <rect
            fill={ART.lampGlow}
            height={10}
            rx={2}
            stroke={ART.lampPost}
            strokeWidth={2}
            width={12}
            x={x + w / 2 - 6}
            y={y - 1}
          />
          <rect fill={ART.lampPost} height={4} width={14} x={x + w / 2 - 7} y={y + 28} />
        </>
      );
    }
    case 'pond': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return (
        <>
          <ellipse cx={cx} cy={cy} fill={ART.pondRim} rx={w / 2 - 2} ry={h / 2 - 4} />
          <ellipse cx={cx} cy={cy} fill={ART.pond} rx={w / 2 - 7} ry={h / 2 - 9} />
          <ellipse cx={cx} cy={cy + 4} fill={ART.pondDeep} opacity={0.45} rx={w / 3} ry={h / 5} />
          <circle cx={x + 20} cy={y + 26} fill={ART.lily} r={6} />
          <circle cx={x + w - 22} cy={y + h - 26} fill={ART.lily} r={7} />
          <Fish cx={cx} cy={cy} r={18} />
          <Fish reverse cx={cx} cy={cy} r={28} />
          <Fish cx={cx} cy={cy + 6} r={10} />
        </>
      );
    }
    default: {
      const pine = object.id === 'tree_1';
      return (
        <>
          <rect fill={ART.trunk} height={12} width={6} x={x + w / 2 - 3} y={y + h - 12} />
          {pine ? (
            <path
              d={`M${x + w / 2} ${y - 14} L${x + w + 2} ${y + h - 10} L${x - 2} ${y + h - 10} Z`}
              fill={ART.leafDark}
            />
          ) : (
            <>
              <circle cx={x + w / 2} cy={y + 6} fill={ART.leafDark} r={17} />
              <circle cx={x + w / 2 - 4} cy={y + 2} fill={ART.leaf} r={11} />
            </>
          )}
        </>
      );
    }
  }
};

interface SceneObjectProps {
  highlighted?: boolean;
  label: string;
  object: GameObject;
  onSelect: (object: GameObject) => void;
}

/** One interactive object of the yard; clicking it sends the character there. */
const SceneObject = memo<SceneObjectProps>(({ highlighted, label, object, onSelect }) => {
  const box = getObjectBox(object);

  return (
    <g
      aria-label={label}
      data-object-id={object.id}
      role="button"
      tabIndex={0}
      {...stylex.props(styles.target)}
      onClick={() => onSelect(object)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(object);
        }
      }}
    >
      <title>{label}</title>
      {highlighted && (
        <rect
          fill="none"
          height={box.h + 8}
          rx={6}
          stroke={ART.windowLight}
          strokeDasharray="4 3"
          strokeWidth={2}
          width={box.w + 8}
          x={box.x - 4}
          y={box.y - 4}
        />
      )}
      {drawObject(object, box)}
    </g>
  );
});

SceneObject.displayName = 'MiniGameSceneObject';

export default SceneObject;
