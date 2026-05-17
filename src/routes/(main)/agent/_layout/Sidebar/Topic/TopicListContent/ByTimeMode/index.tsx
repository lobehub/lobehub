'use client';

import { memo } from 'react';

import GroupedAccordion from '../GroupedAccordion';
import GroupItem from './GroupItem';

interface ByTimeModeProps {
  onOpenDrawer?: () => void;
}

const ByTimeMode = memo<ByTimeModeProps>(({ onOpenDrawer }) => (
  <GroupedAccordion GroupItem={GroupItem} onOpenDrawer={onOpenDrawer} />
));

ByTimeMode.displayName = 'ByTimeMode';

export default ByTimeMode;
