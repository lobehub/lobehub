'use client';

import { memo } from 'react';

import GroupedAccordion from '../GroupedAccordion';
import GroupItem from './GroupItem';

const ByStatusMode = memo(() => <GroupedAccordion GroupItem={GroupItem} />);

ByStatusMode.displayName = 'ByStatusMode';

export default ByStatusMode;
