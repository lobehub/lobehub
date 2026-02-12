/**
 * Route metadata mapping for navigation history
 * Provides title and icon information based on route path
 */
import { type LucideIcon } from 'lucide-react';
import { Circle, Home, MessageSquare, Rocket, ShapesIcon, Users } from 'lucide-react';

import { getRouteById } from '@/config/routes';

export interface RouteMetadata {
  icon?: LucideIcon;
  /** i18n key for the title (namespace: electron) */
  titleKey: string;
  /** Whether this route should use document.title for more specific title */
  useDynamicTitle?: boolean;
}

interface RoutePattern {
  icon?: LucideIcon;
  test: (pathname: string) => boolean;
  /** i18n key for the title (namespace: electron) */
  titleKey: string;
  /** Whether this route should use document.title for more specific title */
  useDynamicTitle?: boolean;
}

// Get shared icons
const communityIcon = getRouteById('community')?.icon;
const resourceIcon = getRouteById('resource')?.icon;
const memoryIcon = getRouteById('memory')?.icon;
const imageIcon = getRouteById('image')?.icon;
const pageIcon = getRouteById('page')?.icon;
const settingsIcon = getRouteById('settings')?.icon;

/**
 * Route patterns ordered by specificity (most specific first)
 */
const routePatterns: RoutePattern[] = [
  // Settings routes
  {
    icon: settingsIcon,
    test: (p) => p.startsWith('/settings/provider'),
    titleKey: 'navigation.provider',
  },
  {
    icon: settingsIcon,
    test: (p) => p.startsWith('/settings'),
    titleKey: 'navigation.settings',
  },

  // Agent/Chat routes - use dynamic title for specific chat names
  {
    icon: MessageSquare,
    test: (p) => p.startsWith('/agent/'),
    titleKey: 'navigation.chat',
    useDynamicTitle: true,
  },
  {
    icon: MessageSquare,
    test: (p) => p === '/agent',
    titleKey: 'navigation.chat',
  },

  // Group routes - use dynamic title for specific group names
  {
    icon: Users,
    test: (p) => p.startsWith('/group/'),
    titleKey: 'navigation.groupChat',
    useDynamicTitle: true,
  },
  {
    icon: Users,
    test: (p) => p === '/group',
    titleKey: 'navigation.group',
  },

  // Community/Discover routes
  {
    icon: ShapesIcon,
    test: (p) => p.startsWith('/community/agent'),
    titleKey: 'navigation.discoverAssistants',
  },
  {
    icon: communityIcon,
    test: (p) => p.startsWith('/community/model'),
    titleKey: 'navigation.discoverModels',
  },
  {
    icon: communityIcon,
    test: (p) => p.startsWith('/community/provider'),
    titleKey: 'navigation.discoverProviders',
  },
  {
    icon: communityIcon,
    test: (p) => p.startsWith('/community/mcp'),
    titleKey: 'navigation.discoverMcp',
  },
  {
    icon: communityIcon,
    test: (p) => p.startsWith('/community'),
    titleKey: 'navigation.discover',
  },

  // Resource/Knowledge routes
  {
    icon: resourceIcon,
    test: (p) => p.startsWith('/resource/library'),
    titleKey: 'navigation.knowledgeBase',
  },
  {
    icon: resourceIcon,
    test: (p) => p.startsWith('/resource'),
    titleKey: 'navigation.resources',
  },

  // Memory routes
  {
    icon: memoryIcon,
    test: (p) => p.startsWith('/memory/identities'),
    titleKey: 'navigation.memoryIdentities',
  },
  {
    icon: memoryIcon,
    test: (p) => p.startsWith('/memory/contexts'),
    titleKey: 'navigation.memoryContexts',
  },
  {
    icon: memoryIcon,
    test: (p) => p.startsWith('/memory/preferences'),
    titleKey: 'navigation.memoryPreferences',
  },
  {
    icon: memoryIcon,
    test: (p) => p.startsWith('/memory/experiences'),
    titleKey: 'navigation.memoryExperiences',
  },
  {
    icon: memoryIcon,
    test: (p) => p.startsWith('/memory'),
    titleKey: 'navigation.memory',
  },

  // Image routes
  {
    icon: imageIcon,
    test: (p) => p.startsWith('/image'),
    titleKey: 'navigation.image',
  },

  // Page routes - use dynamic title for specific page names
  {
    icon: pageIcon,
    test: (p) => p.startsWith('/page/'),
    titleKey: 'navigation.page',
    useDynamicTitle: true,
  },
  {
    icon: pageIcon,
    test: (p) => p === '/page',
    titleKey: 'navigation.pages',
  },

  // Onboarding
  {
    icon: Rocket,
    test: (p) => p.startsWith('/desktop-onboarding') || p.startsWith('/onboarding'),
    titleKey: 'navigation.onboarding',
  },

  // Home (default)
  {
    icon: Home,
    test: (p) => p === '/' || p === '',
    titleKey: 'navigation.home',
  },
];

/**
 * Get route metadata based on pathname
 * @param pathname - The current route pathname
 * @returns Route metadata with titleKey, icon, and useDynamicTitle flag
 */
export const getRouteMetadata = (pathname: string): RouteMetadata => {
  // Find the first matching pattern
  for (const pattern of routePatterns) {
    if (pattern.test(pathname)) {
      return {
        icon: pattern.icon,
        titleKey: pattern.titleKey,
        useDynamicTitle: pattern.useDynamicTitle,
      };
    }
  }

  // Default fallback
  return {
    icon: Circle,
    titleKey: 'navigation.lobehub',
  };
};

/**
 * Get route icon based on pathname or URL
 * @param url - The route URL (may include query string)
 * @returns LucideIcon component or undefined
 */
export const getRouteIcon = (url: string): LucideIcon | undefined => {
  // Extract pathname from URL
  const pathname = url.split('?')[0];
  const metadata = getRouteMetadata(pathname);
  return metadata.icon;
};
