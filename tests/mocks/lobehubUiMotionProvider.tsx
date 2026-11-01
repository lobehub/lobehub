/**
 * Test replacement for @lobehub/ui's internal MotionProvider module (wired in
 * vitest.config.mts). The real `useMotionComponent` throws unless the app-level
 * ConfigProvider supplies a motion implementation, which unit tests don't mount —
 * this stub defaults the context to static passthrough elements so real base-ui
 * components render without per-file mocks. Motion-only props are stripped so
 * they don't leak onto DOM nodes as unknown attributes.
 */
import type { FC, ReactNode, RefObject } from 'react';
import { createContext, createElement, use } from 'react';

const MOTION_ONLY_PROPS = [
  'animate',
  'custom',
  'drag',
  'dragConstraints',
  'dragElastic',
  'dragMomentum',
  'exit',
  'initial',
  'layout',
  'layoutDependency',
  'layoutId',
  'onAnimationComplete',
  'onAnimationStart',
  'onDrag',
  'onDragEnd',
  'onDragStart',
  'onUpdate',
  'transition',
  'variants',
  'viewport',
  'whileDrag',
  'whileFocus',
  'whileHover',
  'whileInView',
  'whileTap',
];

type StubProps = Record<string, unknown> & { ref?: RefObject<HTMLElement | null> };

const componentCache = new Map<string, FC<StubProps>>();

const stubFor = (tag: string) => {
  let cached = componentCache.get(tag);
  if (!cached) {
    cached = ({ ref, ...props }: StubProps) => {
      const { children, ...rest } = props;
      for (const key of MOTION_ONLY_PROPS) delete rest[key];
      return createElement(tag, { ...rest, ref }, children as ReactNode);
    };
    (cached as { displayName?: string }).displayName = `motion.${tag}`;
    componentCache.set(tag, cached);
  }
  return cached;
};

const motionStub = new Proxy(
  {},
  { get: (_target, prop) => (typeof prop === 'string' ? stubFor(prop) : undefined) },
);

export const MotionComponent = createContext<unknown>(motionStub);

export const MotionProvider = ({ children, motion }: { children?: ReactNode; motion?: unknown }) =>
  createElement(MotionComponent, { value: motion ?? motionStub }, children);

export const useMotionComponent = () => use(MotionComponent) ?? motionStub;
