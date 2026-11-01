'use client';

import LabelsContent from '@/features/WorkspaceSetting/Labels';

/**
 * Personal label registry. The same surface serves both scopes — it reads the
 * active workspace itself and falls back to the user's own labels
 * (`workspace_id IS NULL`) when there is none.
 */
const LabelsSetting = () => <LabelsContent />;

LabelsSetting.displayName = 'LabelsSetting';

export default LabelsSetting;
