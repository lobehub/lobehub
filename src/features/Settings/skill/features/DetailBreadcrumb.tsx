'use client';

import type { ConnectorVisibility } from '@lobechat/types';
import { Breadcrumb, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';

import { densityTokens } from '@/styles/density.stylex';

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
  root: {
    paddingBlock: densityTokens['--lobe-density-card-padding'],
    paddingInline: densityTokens['--lobe-density-card-padding'],
  },
});

interface DetailBreadcrumbProps {
  identifier: string;
  /** The list this detail was opened from, e.g. "Connectors". */
  listLabel: string;
  onBack: () => void;
  type: ToolDetailType;
  /** The workspace connector tab the detail was opened from (names that tab's row). */
  visibility?: ConnectorVisibility;
}

/** `Connectors › <entry>`: the second-level page names where it returns to. */
const DetailBreadcrumb = memo<DetailBreadcrumbProps>(
  ({ identifier, listLabel, onBack, type, visibility }) => {
    const name = useToolDisplayName(identifier, type, visibility);

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
  },
);

DetailBreadcrumb.displayName = 'DetailBreadcrumb';

export default DetailBreadcrumb;
