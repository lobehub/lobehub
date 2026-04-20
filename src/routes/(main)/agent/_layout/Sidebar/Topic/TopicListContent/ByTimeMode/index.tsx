'use client';

import { memo } from 'react';

import GroupedAccordion from '../GroupedAccordion';
import GroupItem from './GroupItem';

const ByTimeMode = memo(() => <GroupedAccordion GroupItem={GroupItem} />);

ByTimeMode.displayName = 'ByTimeMode';

export default ByTimeMode;
