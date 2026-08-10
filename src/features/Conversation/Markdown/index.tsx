import { type MarkdownProps } from '@lobehub/ui';
import { Markdown } from '@lobehub/ui';
import { memo, useMemo } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';
import { getTextDirectionFromFirstStrong } from '@/utils/textDirection';

const MarkdownMessage = memo<MarkdownProps>(
  ({
    children,
    componentProps,
    dir: dirProp,
    streamAnimationGranularity,
    style,
    animated,
    ...rest
  }) => {
    const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
      userGeneralSettingsSelectors.config,
    );

    // Match chat input: base direction from first strong char so Persian replies
    // align RTL even when the UI locale is English (and vice versa).
    const autoDir = useMemo(
      () => (typeof children === 'string' ? getTextDirectionFromFirstStrong(children) : null),
      [children],
    );

    return (
      <Markdown
        fontSize={fontSize}
        variant={'chat'}
        componentProps={{
          ...componentProps,
          highlight: {
            fullFeatured: true,
            theme: highlighterTheme,
            ...componentProps?.highlight,
          },
          mermaid: { fullFeatured: false, theme: mermaidTheme, ...componentProps?.mermaid },
        }}
        {...rest}
        animated={animated}
        dir={dirProp ?? autoDir ?? undefined}
        // Per-character stream spans break Arabic/Persian cursive joining.
        // Default to word granularity whenever fade-in animation is on.
        streamAnimationGranularity={streamAnimationGranularity ?? (animated ? 'word' : undefined)}
        style={{
          unicodeBidi: 'plaintext',
          ...style,
        }}
      >
        {children}
      </Markdown>
    );
  },
);

export default MarkdownMessage;
