'use client';

import { Breadcrumb, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';

import type { ToolDetailType } from './SkillDetail';
import { useToolDisplayName } from './useToolDisplayName';

const styles = stylex.create({
  back: {
    cursor: 'pointer',
    padding: 0,
    borderWidth: 0,
    borderStyle: 'none',
    font: 'inherit',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    backgroundColor: 'transparent',
  },
  root: { paddingBlock: '16px', paddingInline: '16px' },
});

interface DetailBreadcrumbProps {
  identifier: string;
  /** The list this detail was opened from, e.g. "Connectors". */
  listLabel: string;
  onBack: () => void;
  type: ToolDetailType;
}

/** `Connectors › <entry>`: the second-level page names where it returns to. */
const DetailBreadcrumb = memo<DetailBreadcrumbProps>(({ identifier, listLabel, onBack, type }) => {
  const name = useToolDisplayName(identifier, type);

  return (
    <div {...stylex.props(styles.root)}>
      <Breadcrumb
        separator={<Icon icon={ChevronRight} size={14} />}
        items={[
          {
            title: (
              <button type={'button'} {...stylex.props(styles.back)} onClick={onBack}>
                {listLabel}
              </button>
            ),
          },
          {
            title: (
              <Text ellipsis as={'span'} style={{ maxWidth: 320 }} weight={500}>
                {name}
              </Text>
            ),
          },
        ]}
      />
    </div>
  );
});

DetailBreadcrumb.displayName = 'DetailBreadcrumb';

export default DetailBreadcrumb;
