'use client';

import { memo } from 'react';

import GroupedAccordion from '../GroupedAccordion';
import GroupItem from './GroupItem';

interface ByProjectModeProps {
  onOpenDrawer?: () => void;
}

const ByProjectMode = memo<ByProjectModeProps>(({ onOpenDrawer }) => (
  <GroupedAccordion GroupItem={GroupItem} onOpenDrawer={onOpenDrawer} />
));

ByProjectMode.displayName = 'ByProjectMode';

export default ByProjectMode;
