import { Markdown } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  markdown: css`
    h2 {
      margin-block: 24px 12px;
      font-size: 16px;
      font-weight: 600;
    }

    h3 {
      margin-block: 16px 8px;
      font-size: 14px;
      font-weight: 500;
    }

    p {
      margin-block-end: 8px;
      font-size: 14px;
      line-height: 1.6;
      color: ${cssVar.colorTextSecondary};
    }

    ul {
      margin-block: 8px;
      margin-inline: 0;
      padding-inline-start: 20px;

      li {
        margin-block-end: 4px;
        font-size: 14px;
        line-height: 1.6;
        color: ${cssVar.colorTextSecondary};
      }
    }

    strong {
      font-weight: 500;
      color: ${cssVar.colorText};
    }
  `,
}));

interface PersonaDetailProps {
  children: string;
}

const PersonaDetail = memo<PersonaDetailProps>(({ children }) => {
  return (
    <Markdown className={styles.markdown} enableImageGallery={false} enableLatex={false}>
      {children}
    </Markdown>
  );
});

export default PersonaDetail;
