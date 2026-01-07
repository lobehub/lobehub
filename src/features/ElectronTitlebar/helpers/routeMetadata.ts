/**
 * Route metadata mapping for navigation history
 * Provides title and icon information based on route path
 */

export interface RouteMetadata {
  icon?: string;
  title: string;
}

interface RoutePattern {
  icon?: string;
  test: (pathname: string) => boolean;
  title: string | ((pathname: string) => string);
}

/**
 * Route patterns ordered by specificity (most specific first)
 */
const routePatterns: RoutePattern[] = [
  // Settings routes
  {
    icon: 'Settings',
    test: (p) => p.startsWith('/settings/provider'),
    title: 'Provider',
  },
  {
    icon: 'Settings',
    test: (p) => p.startsWith('/settings'),
    title: 'Settings',
  },

  // Agent/Chat routes
  {
    icon: 'MessageSquare',
    test: (p) => p.startsWith('/agent/'),
    title: 'Chat',
  },
  {
    icon: 'MessageSquare',
    test: (p) => p === '/agent',
    title: 'Agent',
  },

  // Group routes
  {
    icon: 'Users',
    test: (p) => p.startsWith('/group/'),
    title: 'Group Chat',
  },
  {
    icon: 'Users',
    test: (p) => p === '/group',
    title: 'Group',
  },

  // Community/Discover routes
  {
    icon: 'Compass',
    test: (p) => p.startsWith('/community/assistant'),
    title: 'Discover Assistants',
  },
  {
    icon: 'Compass',
    test: (p) => p.startsWith('/community/model'),
    title: 'Discover Models',
  },
  {
    icon: 'Compass',
    test: (p) => p.startsWith('/community/provider'),
    title: 'Discover Providers',
  },
  {
    icon: 'Compass',
    test: (p) => p.startsWith('/community/mcp'),
    title: 'Discover MCP',
  },
  {
    icon: 'Compass',
    test: (p) => p.startsWith('/community'),
    title: 'Discover',
  },

  // Resource/Knowledge routes
  {
    icon: 'Database',
    test: (p) => p.startsWith('/resource/library'),
    title: 'Knowledge Base',
  },
  {
    icon: 'Database',
    test: (p) => p.startsWith('/resource'),
    title: 'Resources',
  },

  // Memory routes
  {
    icon: 'Brain',
    test: (p) => p.startsWith('/memory/identities'),
    title: 'Memory - Identities',
  },
  {
    icon: 'Brain',
    test: (p) => p.startsWith('/memory/contexts'),
    title: 'Memory - Contexts',
  },
  {
    icon: 'Brain',
    test: (p) => p.startsWith('/memory/preferences'),
    title: 'Memory - Preferences',
  },
  {
    icon: 'Brain',
    test: (p) => p.startsWith('/memory/experiences'),
    title: 'Memory - Experiences',
  },
  {
    icon: 'Brain',
    test: (p) => p.startsWith('/memory'),
    title: 'Memory',
  },

  // Image routes
  {
    icon: 'Image',
    test: (p) => p.startsWith('/image'),
    title: 'Image',
  },

  // Page routes
  {
    icon: 'FileText',
    test: (p) => p.startsWith('/page/'),
    title: 'Page',
  },
  {
    icon: 'FileText',
    test: (p) => p === '/page',
    title: 'Pages',
  },

  // Onboarding
  {
    icon: 'Rocket',
    test: (p) => p.startsWith('/desktop-onboarding') || p.startsWith('/onboarding'),
    title: 'Onboarding',
  },

  // Home (default)
  {
    icon: 'Home',
    test: (p) => p === '/' || p === '',
    title: 'Home',
  },
];

/**
 * Get route metadata based on pathname
 * @param pathname - The current route pathname
 * @returns Route metadata with title and optional icon
 */
export const getRouteMetadata = (pathname: string): RouteMetadata => {
  // Find the first matching pattern
  for (const pattern of routePatterns) {
    if (pattern.test(pathname)) {
      const title = typeof pattern.title === 'function' ? pattern.title(pathname) : pattern.title;
      return {
        icon: pattern.icon,
        title,
      };
    }
  }

  // Default fallback
  return {
    icon: 'Circle',
    title: 'LobeHub',
  };
};
