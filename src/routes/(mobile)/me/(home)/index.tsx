'use client';

import { Center } from '@lobehub/ui';
import { memo, useState } from 'react';

import BrandWatermark from '@/components/BrandWatermark';
import ChangelogModal from '@/components/ChangelogModal';

import Category from './features/Category';
import UserBanner from './features/UserBanner';

const MeHomePage = memo(() => {
  const [isChangelogModalOpen, setIsChangelogModalOpen] = useState(false);
  const [shouldLoadChangelog, setShouldLoadChangelog] = useState(false);

  const handleOpenChangelogModal = () => {
    setShouldLoadChangelog(true);
    setIsChangelogModalOpen(true);
  };

  const handleCloseChangelogModal = () => {
    setIsChangelogModalOpen(false);
  };

  return (
    <>
      <UserBanner />
      <Category onOpenChangelogModal={handleOpenChangelogModal} />
      <Center padding={16}>
        <BrandWatermark />
      </Center>
      <ChangelogModal
        open={isChangelogModalOpen}
        shouldLoad={shouldLoadChangelog}
        onClose={handleCloseChangelogModal}
      />
    </>
  );
});

MeHomePage.displayName = 'MeHomePage';

export default MeHomePage;
