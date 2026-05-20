'use client';

import { memo } from 'react';

import GroupedAccordion from '../GroupedAccordion';
import GroupItem from './GroupItem';

const ByProjectMode = memo(() => <GroupedAccordion GroupItem={GroupItem} />);

ByProjectMode.displayName = 'ByProjectMode';

export default ByProjectMode;
