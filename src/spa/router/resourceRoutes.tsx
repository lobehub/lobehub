'use client';

import {
  ClipboardListIcon,
  FilePenIcon,
  FilesIcon,
  FileText,
  HardDriveIcon,
  ImageIcon,
  LibraryBigIcon,
  Mic2,
  SquarePlay,
} from 'lucide-react';
import type { RouteObject } from 'react-router';

import { BusinessResourceRoutes } from '@/business/client/BusinessDesktopRoutes';
import ResourceHomeSkeleton from '@/components/Skeleton/ResourceHome';
import { createSurfaceSkeleton } from '@/components/Skeleton/Surface';
import ResourceCategorySkeleton from '@/features/ResourceHome/Skeleton';
import { libraryTreeLoader } from '@/spa/router/libraryTreeLoader';
import { routeMeta } from '@/spa/router/routeMeta';
import { worksLoader } from '@/spa/router/worksLoader';
import { dynamicElement, ErrorBoundary } from '@/utils/router';

// Drive views share the Docs home page: /resource/drive, /resource/drive/images, …
const resourceDriveRoutes: RouteObject[] = [
  { icon: HardDriveIcon, path: 'drive', titleKey: 'navigation.resourceDrive' },
  { icon: FileText, path: 'drive/documents', titleKey: 'navigation.resourceDocuments' },
  { icon: ImageIcon, path: 'drive/images', titleKey: 'navigation.resourceImages' },
  { icon: SquarePlay, path: 'drive/videos', titleKey: 'navigation.resourceVideos' },
  { icon: Mic2, path: 'drive/audios', titleKey: 'navigation.resourceAudios' },
  { icon: FilesIcon, path: 'drive/files', titleKey: 'navigation.resourceFiles' },
  { icon: HardDriveIcon, path: 'drive/:category', titleKey: 'navigation.resourceDrive' },
].map(({ icon, path, titleKey }) => ({
  element: dynamicElement(
    () => import('@/routes/(main)/resource/(home)'),
    `Desktop > Resource > Home > ${path}`,
    { preloadId: 'resource' },
  ),
  handle: { meta: routeMeta({ icon, titleKey }) },
  path,
}));

/**
 * Docs (`/resource`): the home dashboard, the drive, the library gallery and
 * Works share one layout and sidebar; a library opens under `library/:id` with
 * its own sidebar. Shared by the root and the workspace route trees.
 */
export const resourceRoute: RouteObject = {
  children: [
    // Home routes (resource list)
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/(home)'),
            'Desktop > Resource > Home',
            { preloadId: 'resource' },
          ),
          handle: {
            meta: routeMeta({
              icon: LibraryBigIcon,
              Skeleton: ResourceHomeSkeleton,
              titleKey: 'navigation.resources',
            }),
          },
          index: true,
        },
        ...BusinessResourceRoutes,
        ...resourceDriveRoutes,
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/(home)'),
            'Desktop > Resource > Home > Works',
            { preloadId: 'resource' },
          ),
          handle: {
            meta: routeMeta({ icon: ClipboardListIcon, titleKey: 'navigation.resourceWorks' }),
          },
          loader: worksLoader,
          path: 'works',
        },
        // Library gallery: every library as a cover card; a library itself
        // opens under `library/:id` with its own sidebar.
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/(home)/library'),
            'Desktop > Resource > Library Gallery',
            { preloadId: 'resource' },
          ),
          handle: {
            meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
          },
          path: 'library',
        },
        // Legacy /resource/page (pages left the drive): a static segment, since
        // the dynamic `:category` ties with the workspace mirror
        // `/:workspaceSlug/page` on route score and would be swallowed into a
        // slug 404. The page redirects to the Docs home.
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/(home)'),
            'Desktop > Resource > Home > Pages',
            { preloadId: 'resource' },
          ),
          handle: {
            meta: routeMeta({ icon: FilePenIcon, titleKey: 'navigation.resourcePages' }),
          },
          path: 'page',
        },
        // A page or file opened inside Docs, over the home dashboard.
        ...(
          [
            { icon: FilePenIcon, path: 'page/:id', titleKey: 'navigation.resourcePages' },
            { icon: FilesIcon, path: 'file/:id', titleKey: 'navigation.resourceFiles' },
          ] as const
        ).map(({ icon, path, titleKey }) => ({
          element: dynamicElement(
            () => import('@/routes/(main)/resource/(home)'),
            `Desktop > Resource > Home > ${path}`,
            { preloadId: 'resource' },
          ),
          handle: { meta: routeMeta({ icon, titleKey }) },
          path,
        })),
        // Legacy category paths (/resource/documents, /resource/all, …)
        // redirect into the drive.
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/(home)'),
            'Desktop > Resource > Home > Category',
            { preloadId: 'resource' },
          ),
          handle: {
            meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.resources' }),
          },
          loader: worksLoader,
          path: ':category',
        },
      ],
      element: dynamicElement(
        () => import('@/routes/(main)/resource/(home)/_layout'),
        'Desktop > Resource > Home > Layout',
        { preloadId: 'resource' },
      ),
      handle: { meta: routeMeta({ Skeleton: ResourceCategorySkeleton }) },
    },
    // Library routes (knowledge base detail)
    {
      children: [
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/library'),
            'Desktop > Resource > Library',
          ),
          handle: {
            meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
          },
          index: true,
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/library/permission'),
            'Desktop > Resource > Library > Permission',
          ),
          handle: {
            meta: routeMeta({
              icon: LibraryBigIcon,
              Skeleton: createSurfaceSkeleton('form'),
              titleKey: 'navigation.knowledgeBase',
            }),
          },
          path: 'permission',
        },
        {
          element: dynamicElement(
            () => import('@/routes/(main)/resource/library/[slug]'),
            'Desktop > Resource > Library > Slug',
          ),
          handle: {
            meta: routeMeta({ icon: LibraryBigIcon, titleKey: 'navigation.knowledgeBase' }),
          },
          path: ':slug',
        },
      ],
      element: dynamicElement(
        () => import('@/routes/(main)/resource/library/_layout'),
        'Desktop > Resource > Library > Layout',
      ),
      loader: libraryTreeLoader,
      path: 'library/:id',
    },
  ],
  element: dynamicElement(
    () => import('@/routes/(main)/resource/_layout'),
    'Desktop > Resource > Layout',
    { preloadId: 'resource' },
  ),
  errorElement: <ErrorBoundary />,
  handle: { meta: routeMeta({ Skeleton: createSurfaceSkeleton('list') }) },
  path: 'resource',
};
