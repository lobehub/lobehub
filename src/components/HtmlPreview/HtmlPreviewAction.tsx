import { ActionIcon } from '@lobehub/ui';
import { Eye } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import HtmlPreviewDrawer from './PreviewDrawer';

interface HtmlPreviewActionProps {
  content: string;
  size?: number;
}

const HtmlPreviewAction = memo<HtmlPreviewActionProps>(({ content, size }) => {
  const { t } = useTranslation('components');
  const [open, setOpen] = useState(false);

  return (
    <>
      <ActionIcon
        icon={Eye}
        size={size}
        title={t('HtmlPreview.actions.preview')}
        onClick={() => setOpen(true)}
      />
      <HtmlPreviewDrawer content={content} open={open} onClose={() => setOpen(false)} />
    </>
  );
});

HtmlPreviewAction.displayName = 'HtmlPreviewAction';

export default HtmlPreviewAction;
