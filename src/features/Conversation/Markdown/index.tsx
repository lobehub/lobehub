import { type MarkdownProps } from '@lobehub/ui';
import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const MarkdownMessage = memo<MarkdownProps>(({ children, componentProps, ...rest }) => {
  const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
    userGeneralSettingsSelectors.config,
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
    >
      {children}
    </Markdown>
  );
});

export default MarkdownMessage;
