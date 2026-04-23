import { isDesktop } from '@lobechat/const';
import { Button, Flexbox } from '@lobehub/ui';
import { ExternalLink, Settings2 } from 'lucide-react';

import { electronSystemService } from '@/services/electron/system';

interface GuideActionsProps {
  docsUrl?: string;
  onOpenSystemTools?: () => void;
  openDocsLabel?: string;
  openSystemToolsLabel?: string;
  showDocs?: boolean;
}

const GuideActions = ({
  docsUrl,
  onOpenSystemTools,
  openDocsLabel,
  openSystemToolsLabel,
  showDocs = false,
}: GuideActionsProps) => {
  const showDocsButton = showDocs && Boolean(docsUrl && openDocsLabel);
  const showSystemToolsButton = Boolean(onOpenSystemTools && openSystemToolsLabel);

  if (!showDocsButton && !showSystemToolsButton) return null;

  return (
    <Flexbox horizontal gap={8} justify="flex-end" style={{ flexWrap: 'wrap' }}>
      {showSystemToolsButton && (
        <Button icon={<Settings2 size={14} />} size="small" onClick={onOpenSystemTools}>
          {openSystemToolsLabel}
        </Button>
      )}
      {showDocsButton && docsUrl && openDocsLabel && (
        <Button
          icon={<ExternalLink size={14} />}
          size="small"
          type="primary"
          onClick={() => {
            const openLink = isDesktop
              ? electronSystemService.openExternalLink(docsUrl)
              : Promise.resolve(window.open(docsUrl, '_blank', 'noopener,noreferrer'));

            openLink.catch(console.error);
          }}
        >
          {openDocsLabel}
        </Button>
      )}
    </Flexbox>
  );
};

export default GuideActions;
