import './PersonaDetail.css';

import { Markdown } from '@lobehub/ui';
import { memo } from 'react';

interface PersonaDetailProps {
  children: string;
}

const PersonaDetail = memo<PersonaDetailProps>(({ children }) => {
  return (
    <Markdown
      className={'lobe-persona-detail-426e0782-markdown'}
      enableImageGallery={false}
      enableLatex={false}
    >
      {children}
    </Markdown>
  );
});

export default PersonaDetail;
