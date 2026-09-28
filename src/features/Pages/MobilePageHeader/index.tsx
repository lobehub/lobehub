'use client';

import { Flexbox } from '@lobehub/ui';
import { Avatar } from '@lobehub/ui/base-ui';
import { ChatHeader } from '@lobehub/ui/mobile';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';

import { usePageEditorStore } from '@/features/PageEditor/store';
import { mobileHeaderSticky } from '@/styles/mobileHeader';

/**
 * Mobile header for `/page/:id`. Rendered through PageEditor's `header` slot so
 * it reads the live title/emoji from the editor store.
 */
const MobilePageHeader = memo(() => {
  const { t } = useTranslation('file');
  const navigate = useNavigate();
  const location = useLocation();
  const [emoji, title] = usePageEditorStore((s) => [s.emoji, s.title]);

  // Mobile has no page list; go back to wherever the link was opened from, or
  // home when the page is the first entry (e.g. opened from a shared link).
  const handleBack = () => {
    if (location.key === 'default') navigate('/');
    else navigate(-1);
  };

  return (
    <ChatHeader
      showBackButton
      style={mobileHeaderSticky}
      center={
        <ChatHeader.Title
          title={
            <Flexbox horizontal align={'center'} gap={6}>
              {emoji && <Avatar avatar={emoji} shape={'square'} size={20} />}
              {title || t('pageEditor.titlePlaceholder')}
            </Flexbox>
          }
        />
      }
      onBackClick={handleBack}
    />
  );
});

MobilePageHeader.displayName = 'MobilePageHeader';

export default MobilePageHeader;
