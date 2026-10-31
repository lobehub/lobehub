import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

import styles from './PersonaDetail.module.css';

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
