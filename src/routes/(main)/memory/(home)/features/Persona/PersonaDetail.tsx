import { createStaticStyles, Markdown } from '@lobehub/ui';
import { memo } from 'react';

import { densityVars } from '@/styles/densityVars';

const styles = createStaticStyles(({ css, cssVar }) => ({
  markdown: css`
    h2 {
      margin-block: 24px 12px;
      font-size: ${densityVars.pageTitleFontSize};
      font-weight: 600;
    }

    h3 {
      margin-block: 16px 8px;
      font-size: ${densityVars.fontSize};
      font-weight: 500;
    }

    p {
      margin-block-end: 8px;
      font-size: ${densityVars.fontSize};
      line-height: 1.6;
      color: ${cssVar.colorTextSecondary};
    }

    ul {
      margin-block: 8px;
      margin-inline: 0;
      padding-inline-start: 20px;

      li {
        margin-block-end: 4px;
        font-size: ${densityVars.fontSize};
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
