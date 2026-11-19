'use client';

import { AgentAvatar as GeneratedAgentAvatar, type AgentAvatarState } from '@lobehub/ui';
import { type CSSProperties, memo, type MouseEventHandler, type Ref } from 'react';

import { pickDomProps } from './resolve';

export interface GeneratedCharacterProps {
  /** Play the `state` animation of the character. */
  animated?: boolean;
  className?: string;
  /** Props from a wrapping trigger; only the DOM ones are forwarded. */
  domProps?: Record<string, unknown>;
  /** Labels the character. */
  name?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  ref?: Ref<HTMLElement>;
  seed?: string;
  size?: number;
  state?: AgentAvatarState;
  style?: CSSProperties;
}

/**
 * The character `@lobehub/ui` generates from a seed. Wrapped in a span so a
 * trigger around it (Popover, Tooltip) still gets its injected handlers and
 * anchor ref, as it does around an Avatar.
 */
const GeneratedCharacter = memo<GeneratedCharacterProps>(
  ({ animated, className, domProps, name, onClick, ref, seed, size, state, style }) => (
    <span
      {...(domProps && pickDomProps(domProps))}
      className={className}
      ref={ref as Ref<HTMLSpanElement>}
      style={{ display: 'inline-flex', flex: 'none', ...style }}
      onClick={onClick as MouseEventHandler<HTMLSpanElement>}
    >
      <GeneratedAgentAvatar animated={animated} name={name} seed={seed} size={size} state={state} />
    </span>
  ),
);

GeneratedCharacter.displayName = 'GeneratedCharacter';

export default GeneratedCharacter;
