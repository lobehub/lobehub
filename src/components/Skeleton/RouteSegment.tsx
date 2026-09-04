'use client';

import { useLocation } from 'react-router';

import { useRouteSkeletonChrome } from '@/spa/router/routeSkeletonChrome';
import { useRouteSkeleton } from '@/spa/router/useRouteSkeleton';

import AppsSkeleton from './Apps';
import ConversationLayoutSkeleton from './Conversation/Layout';
import DelayedFallback from './Delayed';
import MemorySkeleton from './Memory';
import SettingsPageSkeleton from './Settings/Page';
import SurfaceSkeleton, { type SurfaceSkeletonVariant } from './Surface';

const FORM_SEGMENTS = new Set(['permission', 'profile']);
const GRID_SEGMENTS = new Set(['channel', 'statistics']);
const LIST_SEGMENTS = new Set(['history', 'memory']);

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

const RouteSegmentContent = () => {
  const Skeleton = useRouteSkeleton();
  const chrome = useRouteSkeletonChrome();
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);

  if (Skeleton) return <Skeleton chrome={chrome} />;
  // `settings` at any depth: workspace settings live at /:slug/settings/*
  if (segments.includes('settings')) return <SettingsPageSkeleton chrome={chrome} />;
  if (segments[0] === 'apps') return <AppsSkeleton />;
  if (isConversationPath(pathname)) return <ConversationLayoutSkeleton />;
  if (segments[0] === 'memory' && segments.length === 1) return <MemorySkeleton chrome={chrome} />;

  return <SurfaceSkeleton header={chrome !== 'body'} variant={getSurfaceVariant(pathname)} />;
};

const RouteSegmentSkeleton = () => (
  <DelayedFallback>
    <RouteSegmentContent />
  </DelayedFallback>
);

export default RouteSegmentSkeleton;
