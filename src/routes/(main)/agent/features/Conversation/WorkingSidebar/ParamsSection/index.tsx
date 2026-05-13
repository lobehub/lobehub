import { memo, useState } from 'react';

import Controls from '@/features/ChatInput/ActionBar/Params/Controls';

const ParamsSection = memo(() => {
  const [updating, setUpdating] = useState(false);

  return <Controls setUpdating={setUpdating} updating={updating} variant="sidebar" />;
});

ParamsSection.displayName = 'AgentWorkingSidebarParamsSection';

export default ParamsSection;
