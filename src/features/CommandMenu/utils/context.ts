import { type Context, type MenuContext } from '../types';

/**
 * Configuration for context detection
 */
interface ContextConfig {
  captureSubPath?: boolean;
  matcher: RegExp;
  name: string;
  type: MenuContext;
}

/**
 * Context configurations - easily extensible for adding new contexts
 */
const CONTEXT_CONFIGS: ContextConfig[] = [
  {
    matcher: /^\/agent\/[^/]+$/,
    name: 'Agent',
    type: 'agent',
  },
  {
    matcher: /^\/group\/[^/]+$/,
    name: 'Group',
    type: 'group',
  },
  {
    matcher: /^\/image$/,
    name: 'Painting',
    type: 'painting',
  },
  {
    captureSubPath: true,
    matcher: /^\/settings(?:\/([^/]+))?/,
    name: 'Settings',
    type: 'settings',
  },
  {
    captureSubPath: true,
    matcher: /^\/memory(?:\/([^/]+))?/,
    name: 'Memory',
    type: 'memory',
  },
  {
    captureSubPath: true,
    matcher: /^\/resource(?:\/([^/]+))?/,
    name: 'Resource',
    type: 'resource',
  },
  {
    captureSubPath: true,
    matcher: /^\/page(?:\/([^/]+))?/,
    name: 'Page',
    type: 'page',
  },
];

/**
 * Detects the current context based on pathname
 * @param pathname - The current pathname from react-router
 * @returns Context object if detected, undefined otherwise
 */
export const detectContext = (pathname: string): MenuContext => {
  for (const config of CONTEXT_CONFIGS) {
    const match = pathname.match(config.matcher);

    if (match) {
      const context: Context = {
        name: config.name,
        type: config.type,
      };

      // Capture sub-path if configured
      if (config.captureSubPath && match[1]) {
        context.subPath = match[1];
      }

      return context.type;
    }
  }

  return 'general';
};
