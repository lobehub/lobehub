'use client';

import { memo } from 'react';

import MiniGame from '@/features/MiniGame';

const Body = memo(() => <MiniGame />);

Body.displayName = 'MiniGamePortalBody';

export default Body;
