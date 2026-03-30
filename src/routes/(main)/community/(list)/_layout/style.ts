import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  
  // Content container
contentContainer: css`
    min-height: 100%;
  `,

  
  // Main container
mainContainer: css`
    overflow-y: auto;
  `,

  // Placeholder
  spacer: css`
    flex: 1;
  `,
}));
