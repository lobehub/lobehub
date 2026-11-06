import { Tag } from '@lobehub/ui';
import { FileTextIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { TAG_MARGIN_INLINE_END } from '../constants';

export interface ReferDocumentViewProps {
  title?: string;
}

export const ReferDocumentView = memo<ReferDocumentViewProps>(({ title }) => {
  const { t } = useTranslation('file');

  return (
    <span
      style={{
        display: 'inline-flex',
        marginInlineEnd: TAG_MARGIN_INLINE_END,
        userSelect: 'none',
      }}
    >
      <Tag color="geekblue" icon={<FileTextIcon size={12} />} variant="borderless">
        {title || t('pageList.untitled')}
      </Tag>
    </span>
  );
});

ReferDocumentView.displayName = 'ReferDocumentView';
