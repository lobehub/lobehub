# SPA Routes Restructure Design

## Overview

Restructure the SPA (Vite) routes from Next.js App Router structure to a dedicated `src/routes/` directory, clarifying the separation between:

- **Next.js**: Backend API, Auth routes (SSR), SPA HTML template service
- **Vite SPA**: Page components, route configurations

## Motivation

1. The current `src/app/[variants]/` structure mixes SPA page components with Next.js App Router conventions
2. Route configuration files are nested within page directories, making imports verbose
3. AI documentation needs to reflect the Vite SPA architecture

## Directory Structure Changes

### Before

```
src/app/
├── (backend)/          # Backend API
├── spa/                # SPA HTML template service
├── [variants]/
│   ├── (auth)/         # Auth pages (SSR)
│   ├── (main)/         # Desktop pages
│   ├── (mobile)/       # Mobile pages
│   ├── onboarding/     # Onboarding pages
│   ├── share/          # Share pages
│   └── router/         # Route configurations
├── layout.tsx
├── manifest.ts
├── not-found.tsx
├── robots.tsx
└── sitemap.tsx
```

### After

```
src/
├── app/
│   ├── (backend)/      # Backend API (unchanged)
│   ├── spa/            # SPA HTML template (unchanged)
│   ├── [variants]/
│   │   └── (auth)/     # Auth pages (unchanged, SSR required)
│   ├── layout.tsx
│   ├── manifest.ts
│   ├── not-found.tsx
│   ├── robots.tsx
│   └── sitemap.tsx
├── routes/             # NEW: SPA page components
│   ├── (main)/         # Desktop pages
│   ├── (mobile)/       # Mobile pages
│   ├── onboarding/     # Onboarding pages
│   └── share/          # Share pages
└── router/             # NEW: Route configurations
    ├── desktopRouter.config.tsx
    └── desktopRouter.config.desktop.tsx
```

## Files to Migrate

### SPA Pages (src/app/\[variants] → src/routes)

| Source                           | Destination              |
| -------------------------------- | ------------------------ |
| `src/app/[variants]/(main)/`     | `src/routes/(main)/`     |
| `src/app/[variants]/(mobile)/`   | `src/routes/(mobile)/`   |
| `src/app/[variants]/onboarding/` | `src/routes/onboarding/` |
| `src/app/[variants]/share/`      | `src/routes/share/`      |

### Route Configurations (src/app/\[variants]/router → src/router)

| Source                                                       | Destination                                   |
| ------------------------------------------------------------ | --------------------------------------------- |
| `src/app/[variants]/router/desktopRouter.config.tsx`         | `src/router/desktopRouter.config.tsx`         |
| `src/app/[variants]/router/desktopRouter.config.desktop.tsx` | `src/router/desktopRouter.config.desktop.tsx` |

### Files to Keep in src/app/\[variants]

- `(auth)/` - Auth pages require server-side rendering

## Import Path Updates

### Route Configuration Files

```tsx
// Before
import('../(main)/agent');
import('../(main)/settings/_layout');

// After
import('@/routes/(main)/agent');
import('@/routes/(main)/settings/_layout');
```

### Entry Files (src/entry.web.tsx, etc.)

```tsx
// Before
import { desktopRoutes } from './app/[variants]/router/desktopRouter.config';

// After
import { desktopRoutes } from './router/desktopRouter.config';
```

## AI Documentation Updates

### CLAUDE.md

Update Project Structure section to reflect new directory layout.

### .agents/skills/project-overview/SKILL.md

Update Complete Project Structure section with:

- `src/routes/` for SPA page components
- `src/router/` for route configurations
- Clarify `src/app/` is for Next.js backend only

## Execution Steps

1. Create directories: `src/routes/`, `src/router/`
2. Git mv migrate SPA pages to `src/routes/`
3. Git mv migrate router configs to `src/router/`
4. Update import paths in:
   - `src/router/*.tsx`
   - `src/entry.web.tsx`
   - `src/entry.mobile.tsx`
   - `src/entry.desktop.tsx`
5. Update AI documentation
6. Verify: `bun run type-check` + `bun run dev:spa`

## Risk Assessment

- **Low Risk**: File moves with git mv preserve history
- **Medium Risk**: Import path updates need careful regex
- **Mitigation**: Run type-check after each major step

## Success Criteria

1. All SPA pages moved to `src/routes/`
2. Route configs in `src/router/`
3. All imports updated correctly
4. Type check passes
5. SPA dev mode works
6. AI documentation updated
