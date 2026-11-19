import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import WorkspaceLink from '@/features/Workspace/WorkspaceLink';

interface Category {
  icon: LucideIcon;
  key: string;
  label: string;
}

interface CatalogSectionsProps {
  categories: Category[];
  moreLabel: string;
  path: string;
  renderPreview: (category: string) => ReactNode;
}

const categoriesPerBatch = 4;

export const CatalogSections = ({
  categories,
  moreLabel,
  path,
  renderPreview,
}: CatalogSectionsProps) => {
  const [limit, setLimit] = useState(categoriesPerBatch);

  return (
    <Flexbox gap={32}>
      {categories.slice(0, limit).map(({ key, label, icon }) => (
        <Flexbox gap={12} key={key}>
          <Text as="h3" fontSize={16} weight={600}>
            <WorkspaceLink
              style={{ alignItems: 'center', display: 'inline-flex', gap: 8 }}
              to={path + '?' + new URLSearchParams({ category: key })}
            >
              <Icon icon={icon} size={18} />
              {label}
              <Icon icon={ChevronRight} size={16} />
            </WorkspaceLink>
          </Text>
          {renderPreview(key)}
        </Flexbox>
      ))}
      {categories.length > limit && (
        <Button
          icon={ChevronDown}
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setLimit((current) => current + categoriesPerBatch)}
        >
          {moreLabel}
        </Button>
      )}
    </Flexbox>
  );
};
