// Fixture: a file-type filter over one drive list; each option already lands in the URL.
// Reduced from ResourceManager Explorer/Header/DriveCategoryTabs (and WorkGallery WorksTypeTabs).
import { Segmented } from '@lobehub/ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

const CATEGORIES = ['all', 'documents', 'images', 'videos', 'audios', 'files'] as const;
type Category = (typeof CATEGORIES)[number];

/** File types the drive filters by. */
const driveCategoryPath = (category: Category) =>
  category === 'all' ? '/resource/drive' : `/resource/drive/${category}`;

const DriveCategoryTabs = memo<{ category: Category }>(({ category }) => {
  const { t } = useTranslation('file');
  const navigate = useNavigate();
  const options = useMemo(
    () => CATEGORIES.map((value) => ({ label: t(`tab.${value}`), value })),
    [t],
  );

  return (
    <Segmented
      options={options}
      size={'small'}
      value={category}
      onChange={(value) => navigate(driveCategoryPath(value as Category), { replace: true })}
    />
  );
});

export default DriveCategoryTabs;
