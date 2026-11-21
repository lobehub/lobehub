'use client';

import { ActionIcon, Center, Spin } from '@lobehub/ui';
import { ChevronDownIcon } from 'lucide-react';
import * as m from 'motion/react-m';

interface HierarchyNodeToggleProps {
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: () => void;
}

/**
 * Expand caret of a tree row, or a spinner while its children load. Shared by
 * folders and by documents that hold other documents. The click stops here so
 * it never reaches the row, which navigates or opens the item.
 */
const HierarchyNodeToggle = ({ isExpanded, isLoading, onToggle }: HierarchyNodeToggleProps) =>
  isLoading ? (
    <Center flex={'none'} width={20}>
      <Spin size={'small'} />
    </Center>
  ) : (
    <m.div
      animate={{ rotate: isExpanded ? 0 : -90 }}
      initial={false}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
    >
      <ActionIcon
        icon={ChevronDownIcon}
        size={'small'}
        style={{ width: 20 }}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      />
    </m.div>
  );

export default HierarchyNodeToggle;
