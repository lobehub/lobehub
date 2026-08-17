'use client';

import { useLocation } from 'react-router';

import ConversationLayoutSkeleton from './Conversation/Layout';
import GoalSkeleton from './Goal';
import GoalDetailSkeleton from './GoalDetail';
import MemorySkeleton from './Memory';
import ProfileSkeleton from './Profile';
import SettingsPageSkeleton from './Settings/Page';
import SurfaceSkeleton, { type SurfaceSkeletonVariant } from './Surface';

const FORM_SEGMENTS = new Set(['permission', 'profile']);
const GRID_SEGMENTS = new Set(['channel', 'statistics']);
const LIST_SEGMENTS = new Set(['history', 'memory', 'topics']);

const getSurfaceVariant = (pathname: string): SurfaceSkeletonVariant => {
  const segments = pathname.split('/').filter(Boolean);
  const leaf = segments.at(-1) ?? '';

  if (segments[0] === 'page' || segments.includes('docs') || segments.includes('task')) {
    return 'editor';
  }
  if (FORM_SEGMENTS.has(leaf)) return 'form';
  if (GRID_SEGMENTS.has(leaf)) return 'grid';
  if (LIST_SEGMENTS.has(leaf)) return 'list';

  return 'list';
};

const isConversationPath = (pathname: string) => {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'agent' && segments[0] !== 'group') return false;
  if (segments.length === 2) return true;
  return segments.length === 3 && segments[2].startsWith('tpc_');
};

/**
 * Structural fallback shared by nested route boundaries.
 *
 * It deliberately maps URLs to settled surface families instead of drawing one
 * universal placeholder. This keeps parent and leaf Suspense boundaries on the
 * same visual structure while their chunks resolve at different times.
 */
const RouteSegmentSkeleton = () => {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  if (pathname.startsWith('/settings/')) return <SettingsPageSkeleton />;
  if (isConversationPath(pathname)) return <ConversationLayoutSkeleton />;
  if (segments[0] === 'memory' && segments.length === 1) return <MemorySkeleton />;
  if (segments[0] === 'agent' && segments[2] === 'goals') return <GoalSkeleton />;
  if (segments[0] === 'agent' && segments[2] === 'goal') return <GoalDetailSkeleton />;
  if (segments[0] === 'agent' && segments[2] === 'profile') return <ProfileSkeleton />;
  if (segments[0] === 'group' && segments[2] === 'profile') {
    return <ProfileSkeleton variant={'group'} />;
  }

  return <SurfaceSkeleton variant={getSurfaceVariant(pathname)} />;
};

export default RouteSegmentSkeleton;
