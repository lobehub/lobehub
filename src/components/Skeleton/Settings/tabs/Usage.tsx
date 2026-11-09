'use client';

import { SettingsSectionsBody } from '../Sections';
import { SETTINGS_SECTION_SHAPES } from '../sectionShapes';
import type { SettingsTabSkeleton } from './types';

const Body = () => <SettingsSectionsBody shape={SETTINGS_SECTION_SHAPES.usage} />;

const UsageSkeleton: SettingsTabSkeleton = { Body };

export default UsageSkeleton;
