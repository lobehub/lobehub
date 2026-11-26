/* eslint-disable eslint-core/no-restricted-imports -- the lazy wrapper in @/components/LobeIcons is the only importer */
import {
  IconAvatar,
  IconCombine,
  ProviderCombine as LobeProviderCombine,
  ProviderIcon as LobeProviderIcon,
  providerMappings,
} from '@lobehub/icons';
import { createElement, type CSSProperties, memo } from 'react';

/* eslint-enable eslint-core/no-restricted-imports */

const PROXYSTACKS_TITLE = 'ProxyStacks';

interface SvgIconProps {
  size?: number | string;
  style?: CSSProperties;
}

const ProxyStacksMono = memo(({ size = '1em', style, ...rest }: SvgIconProps) =>
  createElement(
    'svg',
    {
      fill: 'currentColor',
      fillRule: 'evenodd',
      height: size,
      style: { flex: 'none', lineHeight: 1, ...style },
      viewBox: '0 0 24 24',
      width: size,
      xmlns: 'http://www.w3.org/2000/svg',
      ...rest,
    },
    createElement('title', null, PROXYSTACKS_TITLE),
    createElement('path', {
      clipRule: 'evenodd',
      d: 'M6 4H12.8C15.6719 4 18 6.14903 18 8.8C18 10.906 16.5042 12.6957 14.425 13.3406L18.2 20H14.9L11.72 13.6H8.8V20H6V4ZM8.8 6.6V11H12.6C13.9255 11 15 10.015 15 8.8C15 7.58497 13.9255 6.6 12.6 6.6H8.8Z',
    }),
  ),
);

const ProxyStacksText = memo(({ size = '1em', style, ...rest }: SvgIconProps) =>
  createElement(
    'svg',
    {
      fill: 'currentColor',
      height: size,
      style: { flex: 'none', lineHeight: 1, ...style },
      viewBox: '0 0 116 24',
      width: typeof size === 'number' ? Math.round((size * 116) / 24) : '4.83em',
      xmlns: 'http://www.w3.org/2000/svg',
      ...rest,
    },
    createElement('title', null, PROXYSTACKS_TITLE),
    createElement(
      'text',
      {
        dominantBaseline: 'central',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: '18',
        fontWeight: '650',
        letterSpacing: '-0.3',
        x: '0',
        y: '12',
      },
      PROXYSTACKS_TITLE,
    ),
  ),
);

const ProxyStacksAvatar = memo((props: Record<string, unknown>) =>
  createElement(IconAvatar as any, {
    'Icon': ProxyStacksMono,
    'aria-label': PROXYSTACKS_TITLE,
    'background': '#0A0A0A',
    'color': '#FFFFFF',
    'iconMultiple': 0.72,
    ...props,
  }),
);

const ProxyStacksCombine = memo((props: Record<string, unknown>) =>
  createElement(IconCombine as any, {
    'Icon': ProxyStacksMono,
    'Text': ProxyStacksText,
    'aria-label': PROXYSTACKS_TITLE,
    'spaceMultiple': 0.25,
    'textMultiple': 0.85,
    ...props,
  }),
);

const ProxyStacksCompound = Object.assign(ProxyStacksMono, {
  Avatar: ProxyStacksAvatar,
  Combine: ProxyStacksCombine,
  Text: ProxyStacksText,
  colorPrimary: '#0A0A0A',
  title: PROXYSTACKS_TITLE,
});

if (!providerMappings.some((item) => item.keywords.includes('proxystacks'))) {
  providerMappings.push({
    Icon: ProxyStacksCompound as any,
    combineMultiple: 1,
    keywords: ['proxystacks'],
  });
}

// Do not turn these back into `export { ... }` re-exports: with rolldown's
// strictExecutionOrder (rolldown 1.2.12) the icon modules' init wrappers are
// then never called in production chunks, both exports stay undefined and the
// lazy loaders in @/components/LobeIcons crash with React #306.
export const ProviderIcon = LobeProviderIcon;
export const ProviderCombine = LobeProviderCombine;
