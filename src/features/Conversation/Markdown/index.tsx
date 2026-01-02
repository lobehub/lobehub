import { Markdown, type MarkdownProps } from '@lobehub/ui';
import { memo } from 'react';

import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

const MarkdownMessage = memo<MarkdownProps>(({ children, componentProps, ...rest }) => {
  const { highlighterTheme, mermaidTheme, fontSize } = useUserStore(
    userGeneralSettingsSelectors.config,
  );

  return (
    <Markdown
      componentProps={{
        ...componentProps,
        highlight: {
          fullFeatured: true,
          theme: highlighterTheme,
          ...componentProps?.highlight,
        },
        mermaid: { fullFeatured: false, theme: mermaidTheme, ...componentProps?.mermaid },
      }}
      fontSize={fontSize}
      variant={'chat'}
      {...rest}
    >
      {children}
    </Markdown>
  );
});

export default MarkdownMessage;
