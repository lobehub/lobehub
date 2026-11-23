// the code below can only be modified with commercial license
// if you want to use it in the commercial usage
// please contact us for more information: hello@lobehub.com

export const LOBE_CHAT_CLOUD = 'LobeHub Cloud';

export const BRANDING_NAME = 'LobeHub';
// Override to preserve an installed PWA identity independently of its display name.
// An empty value retains the default derived from BRANDING_NAME.
export const BRANDING_PWA_ID = '';
// White-label distributions supply their logo through the business package override.
export const BRANDING_LOGO_URL = '';
// Optional themed symbol and complete wordmarks; empty values retain the fallback.
export const BRANDING_LOGO_DARK_URL = '';
export const BRANDING_WORDMARK_URL = '';
export const BRANDING_WORDMARK_DARK_URL = '';
export const BRANDING_TEXT_LOGO_URL = '';
export const BRANDING_TEXT_LOGO_DARK_URL = '';
// Avatar shown for a person who has not set one. Empty keeps each surface's own
// fallback (an emoji or the person's initials).
export const BRANDING_USER_AVATAR_URL = '';

/**
 * Display name of the built-in default assistant (the inbox agent).
 *
 * Kept separate from `BRANDING_NAME` because it reads as a persona, not a
 * product: white-label deployments usually want something like
 * `'<Brand> AI'` rather than the bare product name. Drives
 * `DEFAULT_INBOX_TITLE` and the i18n brand post-processor, so overriding this
 * one constant renames the assistant everywhere.
 */
export const BRANDING_INBOX_TITLE = 'Lobe AI';

// Display name of the built-in agent capability bundle.
export const BRANDING_AGENT_TITLE = 'Lobe Agent';

// Self-contained square icon for built-in skills (for example, an SVG data URI).
// Separate from the general logo URL so desktop skills need no public assets.
export const BRANDING_ICON_URL = '';

// Distributions can override the legal entity independently of the product name.
export const ORG_NAME = BRANDING_NAME;

export const BRANDING_URL = {
  help: undefined,
  privacy: undefined,
  subscription: 'https://app.lobehub.com/settings/plans',
  support: undefined,
  terms: undefined,
};

export const SOCIAL_URL = {
  discord: 'https://discord.gg/AYFPHvv2jT',
  github: 'https://github.com/lobehub',
  medium: 'https://medium.com/@lobehub',
  x: 'https://x.com/lobehub',
  youtube: 'https://www.youtube.com/@lobehub',
};

export const FILE_URL = {
  importFromNotionGuide: 'https://hub-apac-1.lobeobjects.space/assets/notion.mp4',
};

export const BRANDING_EMAIL = {
  business: 'hello@lobehub.com',
  replyTo: undefined,
  support: 'support@lobehub.com',
};

export const BRANDING_PROVIDER = 'lobehub';

/**
 * User-facing identifier for the default built-in provider (`BRANDING_PROVIDER`,
 * internal id `'lobehub'`). Presentation and external error surfaces only:
 * persisted DB rows (`agents.provider`, `messages.provider`, `ai_providers.id`,
 * `ai_models.provider_id`), runtime config keys and internal routing keep
 * `BRANDING_PROVIDER`, so no data migration is required.
 *
 * Empty upstream (keeps `'lobehub'` / `BRANDING_NAME`). A white-label
 * distribution whose managed upstream has its own provider name (distinct from
 * `BRANDING_NAME` and future custom providers) sets this slot.
 */
export const BRANDING_PROVIDER_DISPLAY_ID: string = '';

/**
 * Builtin tool and skill identifiers start with `lobe-`. A distribution that
 * sets this namespace shows `<namespace>-<name>` wherever the UI prints one
 * (tool popovers, tool-call titles, error fallbacks). Presentation only: agent
 * plugin lists, uninstall settings, Market agent configs and the tool names sent
 * to the model keep the runtime identifier, so no data is migrated. Empty
 * upstream, which shows the runtime identifier.
 */
export const BUILTIN_TOOL_DISPLAY_NAMESPACE: string = '';

/**
 * Display IDs for individual builtin tools, keyed by runtime identifier. An entry
 * here wins over `BUILTIN_TOOL_DISPLAY_NAMESPACE`. Presentation only, like the
 * namespace. Empty upstream.
 */
export const BUILTIN_TOOL_DISPLAY_IDENTIFIERS: Readonly<Record<string, string>> = {};

/**
 * Deep-link scheme the distribution's desktop client registers with the OS
 * (`DESKTOP_PROTOCOL_SCHEME` at package time). The web app opens links such as
 * `<scheme>://device/reconnect` with it, so it must name the client this
 * distribution ships, not the vendor's.
 */
export const DESKTOP_PROTOCOL_SCHEME = 'lobehub';

export const APPLE_APP_STORE_ID = '';

export const COPYRIGHT = `© ${new Date().getFullYear()} ${ORG_NAME}`;
export const COPYRIGHT_FULL = `${COPYRIGHT}. All rights reserved.`;

/** A 13-step colour ramp in the shape `@lobehub/ui` builds every colour role from. */
export type BrandingColorRamp = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

export interface BrandingColorScale {
  dark: BrandingColorRamp;
  darkA: BrandingColorRamp;
  light: BrandingColorRamp;
  lightA: BrandingColorRamp;
}

export interface BrandingTheme {
  /**
   * Raw CSS appended to the global stylesheet. Reads lobe-ui CSS variables
   * (`var(--lobe-…)`) and targets the stable `data-brand-slot` hooks the app
   * shell exposes, so a distribution can restyle the frame without forking
   * component code.
   */
  globalStyle?: string;
  /** Replaces the neutral family (surfaces, borders, fills, text). */
  neutralScale?: BrandingColorScale;
  /** Replaces the primary, info and link families. */
  primaryScale?: BrandingColorScale;
  /** Alias-token overrides (radius, control height, …) applied to both appearances. */
  token?: Record<string, number | string>;
}

// White-label distributions supply their theme through the business package
// override. `undefined` keeps the stock LobeHub theme.
export const BRANDING_THEME: BrandingTheme | undefined = undefined;

export interface AgentAvatarGalleryChoice {
  color: string;
  shape: string;
}

/**
 * A fixed avatar set an agent picks from by combining a body shape with a
 * colour, instead of an emoji or an uploaded image. Every combination is a
 * static image; the chosen one is stored as its URL in the agent's `avatar`
 * field, so every surface that already renders an avatar URL shows it.
 */
export interface AgentAvatarGallery {
  /** Avatars for built-in agents the distribution draws from the gallery. */
  builtinAvatars?: { agentBuilder?: string; inbox?: string };
  /** `swatch` is a CSS `background` value previewing the colour. */
  colors: { key: string; swatch: string }[];
  /** Shown for an agent with no avatar of its own. */
  defaultAvatar: string;
  /** The combination behind a stored avatar, or `undefined` for any other avatar. */
  parse: (avatar?: string | null) => AgentAvatarGalleryChoice | undefined;
  resolve: (choice: AgentAvatarGalleryChoice) => string;
  /** `preview` is the colour-neutral image of the shape. */
  shapes: { key: string; preview: string }[];
}

// `undefined` keeps the emoji / upload / generated avatar picker.
export const AGENT_AVATAR_GALLERY: AgentAvatarGallery | undefined = undefined;
