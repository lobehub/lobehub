'use client';

import { AccordionItem, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import NavItem from '@/features/NavPanel/components/NavItem';
import { parseWorkGalleryKey, WORK_GALLERY_ENTRIES } from '@/features/WorkGallery/const';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

/**
 * The 产物 sidebar group: five entries (all + task / document / linear / github)
 * that switch the resource content area to the cross-topic Work gallery via
 * `?works=<key>`. Parallel to the file "Library" group, but its entries are a
 * flat nav list (like the file category menu) rather than a fetched list.
 */
const WorkBody = memo<{ itemKey: string }>(({ itemKey }) => {
  const { t } = useTranslation('file');
  const navigate = useWorkspaceAwareNavigate();
  const [searchParams] = useSearchParams();
  const activeKey = parseWorkGalleryKey(searchParams.get('works'));

  return (
    <AccordionItem
      itemKey={itemKey}
      paddingBlock={4}
      paddingInline={'8px 4px'}
      title={
        <Text ellipsis fontSize={12} type={'secondary'} weight={500}>
          {t('work.group')}
        </Text>
      }
    >
      <Flexbox gap={1} paddingInline={4}>
        {WORK_GALLERY_ENTRIES.map((entry) => {
          const url = `/resource?works=${entry.key}`;
          return (
            <Link
              key={entry.key}
              to={url}
              onClick={(e) => {
                e.preventDefault();
                navigate(url, { replace: true });
              }}
            >
              <NavItem
                active={activeKey === entry.key}
                icon={entry.icon}
                title={t(`work.tab.${entry.key}`)}
              />
            </Link>
          );
        })}
      </Flexbox>
    </AccordionItem>
  );
});

WorkBody.displayName = 'WorkBody';

export default WorkBody;
