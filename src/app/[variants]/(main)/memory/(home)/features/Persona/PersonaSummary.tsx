import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  summary: css`
    position: relative;

    padding-block: 16px;
    padding-inline: 20px;
    border-radius: 8px;

    font-size: 15px;
    font-style: italic;
    line-height: 1.6;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};

    &::before {
      content: '"';

      position: absolute;
      inset-block-start: 8px;
      inset-inline-start: 12px;

      font-family: Georgia, serif;
      font-size: 28px;
      font-style: normal;
      line-height: 1;
      color: ${cssVar.colorTextQuaternary};
    }
  `,
}));

interface PersonaSummaryProps {
  children: string;
}

const PersonaSummary = memo<PersonaSummaryProps>(({ children }) => {
  return <div className={styles.summary}>{children}</div>;
});

export default PersonaSummary;
