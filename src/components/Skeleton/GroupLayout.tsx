'use client';

import { useLocation } from 'react-router';

import ConversationLayoutSkeleton from './Conversation/Layout';
import ProfileSkeleton from './Profile';
import SurfaceSkeleton from './Surface';

const GroupLayoutSkeleton = () => {
  const { pathname } = useLocation();
  const leaf = pathname.split('/').findLast(Boolean);

  if (leaf === 'profile') return <ProfileSkeleton variant={'group'} />;
  if (leaf === 'permission') return <SurfaceSkeleton variant={'form'} />;

  return <ConversationLayoutSkeleton />;
};

export default GroupLayoutSkeleton;
