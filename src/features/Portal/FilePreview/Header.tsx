import { memo } from 'react';

import ShareButton from '@/business/client/features/FileShare/ShareButton';

import PortalHeader from '../components/Header';
import Title from './Title';
import { usePreviewFileItem } from './usePreviewFileItem';

const Header = memo<{ onClose?: () => void }>(({ onClose }) => {
  const { data, fromSource } = usePreviewFileItem();

  return (
    <PortalHeader
      // A preview opened from a share source is someone else's file; a
      // document-coalesced item carries a `docs_*` id over the file it wraps.
      rightExtra={data && !fromSource ? <ShareButton fileId={data.fileId ?? data.id} /> : undefined}
      title={<Title />}
      onClose={onClose}
    />
  );
});

Header.displayName = 'FilePreviewHeader';

export default Header;
