# SPA Routes Restructure Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure SPA routes from Next.js App Router structure to dedicated `src/routes/` and `src/router/` directories.

**Architecture:** Migrate Vite SPA page components from `src/app/[variants]/` to `src/routes/`, and route configurations to `src/router/`. Keep Next.js App Router for backend API, auth pages, and SPA HTML template service.

**Tech Stack:** Git mv for file migration, TypeScript, react-router-dom, Vite

---

## Prerequisites

- Ensure clean working directory: `git status`
- Ensure on canary branch: `git branch --show-current`

---

### Task 1: Create Target Directories

**Files:**

- Create: `src/routes/` (directory)
- Create: `src/router/` (directory)

**Step 1: Create directories**

```bash
mkdir -p src/routes src/router
```

**Step 2: Verify directories created**

Run: `ls -la src/routes src/router`
Expected: Two empty directories

**Step 3: Commit**

```bash
git add src/routes src/router
git commit -m "🔧 chore: create src/routes and src/router directories"
```

---

### Task 2: Migrate (main) Pages to src/routes

**Files:**

- Move: `src/app/[variants]/(main)/` → `src/routes/(main)/`

**Step 1: Git mv (main) directory**

```bash
git mv src/app/[variants]/\(main\) src/routes/\(main\)
```

**Step 2: Verify migration**

Run: `ls src/routes/\(main\) | head -5`
Expected: List of directories like agent, community, settings, etc.

---

### Task 3: Migrate (mobile) Pages to src/routes

**Files:**

- Move: `src/app/[variants]/(mobile)/` → `src/routes/(mobile)/`

**Step 1: Git mv (mobile) directory**

```bash
git mv src/app/[variants]/\(mobile\) src/routes/\(mobile\)
```

**Step 2: Verify migration**

Run: `ls src/routes/\(mobile\) | head -5`
Expected: List of directories like chat, settings, me, etc.

---

### Task 4: Migrate onboarding Pages to src/routes

**Files:**

- Move: `src/app/[variants]/onboarding/` → `src/routes/onboarding/`

**Step 1: Git mv onboarding directory**

```bash
git mv src/app/[variants]/onboarding src/routes/onboarding
```

**Step 2: Verify migration**

Run: `ls src/routes/onboarding`
Expected: List of files like index.tsx, layout.tsx, etc.

---

### Task 5: Migrate share Pages to src/routes

**Files:**

- Move: `src/app/[variants]/share/` → `src/routes/share/`

**Step 1: Git mv share directory**

```bash
git mv src/app/[variants]/share src/routes/share
```

**Step 2: Verify migration**

Run: `ls src/routes/share`
Expected: List of directories like t/

---

### Task 6: Migrate Router Configurations to src/router

**Files:**

- Move: `src/app/[variants]/router/*.tsx` → `src/router/`

**Step 1: Git mv router files**

```bash
git mv src/app/[variants]/router/desktopRouter.config.tsx src/router/
git mv src/app/[variants]/router/desktopRouter.config.desktop.tsx src/router/
```

**Step 2: Remove empty router directory**

```bash
rmdir src/app/[variants]/router
```

**Step 3: Verify migration**

Run: `ls src/router/`
Expected: Two files - desktopRouter.config.tsx, desktopRouter.config.desktop.tsx

---

### Task 7: Update Import Paths in desktopRouter.config.tsx

**Files:**

- Modify: `src/router/desktopRouter.config.tsx`

**Step 1: Find all relative imports to update**

Run: `grep -n "import\('../" src/router/desktopRouter.config.tsx | head -20`
Expected: List of lines with relative imports like `import('../(main)/agent')`

**Step 2: Replace relative imports with absolute imports**

```bash
sed -i '' "s|import('../(|import('@/routes/(|g" src/router/desktopRouter.config.tsx
```

**Step 3: Replace onboarding import**

```bash
sed -i '' "s|import('../onboarding|import('@/routes/onboarding|g" src/router/desktopRouter.config.tsx
```

**Step 4: Replace share import**

```bash
sed -i '' "s|import('../share|import('@/routes/share|g" src/router/desktopRouter.config.tsx
```

**Step 5: Verify changes**

Run: `grep -n "@/routes" src/router/desktopRouter.config.tsx | head -10`
Expected: Lines showing absolute imports to @/routes/

---

### Task 8: Update Import Paths in desktopRouter.config.desktop.tsx

**Files:**

- Modify: `src/router/desktopRouter.config.desktop.tsx`

**Step 1: Find all relative imports to update**

Run: `grep -n "import\('../" src/router/desktopRouter.config.desktop.tsx | head -10`
Expected: List of lines with relative imports

**Step 2: Replace relative imports with absolute imports**

```bash
sed -i '' "s|import('../(|import('@/routes/(|g" src/router/desktopRouter.config.desktop.tsx
sed -i '' "s|import('../onboarding|import('@/routes/onboarding|g" src/router/desktopRouter.config.desktop.tsx
sed -i '' "s|import('../share|import('@/routes/share|g" src/router/desktopRouter.config.desktop.tsx
```

**Step 3: Verify changes**

Run: `grep -n "@/routes" src/router/desktopRouter.config.desktop.tsx | head -5`
Expected: Lines showing absolute imports

---

### Task 9: Update Entry File Imports

**Files:**

- Modify: `src/entry.web.tsx`
- Modify: `src/entry.mobile.tsx`
- Modify: `src/entry.desktop.tsx`

**Step 1: Update entry.web.tsx**

```bash
sed -i '' "s|'./app/\[variants\]/router/desktopRouter.config'|'./router/desktopRouter.config'|g" src/entry.web.tsx
```

**Step 2: Update entry.mobile.tsx**

```bash
sed -i '' "s|'./app/\[variants\]/router/mobileRouter.config'|'./router/mobileRouter.config'|g" src/entry.mobile.tsx
```

**Step 3: Update entry.desktop.tsx**

```bash
sed -i '' "s|'./app/\[variants\]/router/desktopRouter.config'|'./router/desktopRouter.config'|g" src/entry.desktop.tsx
```

**Step 4: Verify changes**

Run: `grep -n "router" src/entry.web.tsx src/entry.mobile.tsx src/entry.desktop.tsx`
Expected: Lines showing `./router/` imports

---

### Task 10: Run Type Check

**Step 1: Run type check**

Run: `bun run type-check`
Expected: No errors

**Step 2: If errors, investigate and fix**

Common issues:

- Missing import path updates
- tsconfig.json path mapping

---

### Task 11: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

**Step 1: Update Project Structure section**

Replace the `src/app/` description with:

```markdown
├── src/
│ ├── app/ # Next.js App Router (backend API + auth)
│ │ ├── (backend)/ # API routes (trpc, webapi, etc.)
│ │ ├── spa/ # SPA HTML template service
│ │ └── [variants]/(auth)/ # Auth pages (SSR required)
│ ├── routes/ # SPA page components (Vite)
│ │ ├── (main)/ # Desktop pages
│ │ ├── (mobile)/ # Mobile pages
│ │ ├── onboarding/ # Onboarding pages
│ │ └── share/ # Share pages
│ └── router/ # React Router configuration
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "📝 docs: update CLAUDE.md for new routes structure"
```

---

### Task 12: Update project-overview SKILL.md

**Files:**

- Modify: `.agents/skills/project-overview/SKILL.md`

**Step 1: Update Complete Project Structure section**

Update the `src/app/` section to reflect new structure:

```markdown
├── src/
│ ├── app/
│ │ ├── (backend)/
│ │ │ ├── api/
│ │ │ ├── f/
│ │ │ ├── market/
│ │ │ ├── middleware/
│ │ │ ├── oidc/
│ │ │ ├── trpc/
│ │ │ └── webapi/
│ │ ├── spa/ # SPA HTML template service
│ │ ├── [variants]/
│ │ │ └── (auth)/ # Auth pages (SSR)
│ │ ├── layout.tsx
│ │ └── ...
│ ├── routes/ # SPA page components
│ │ ├── (main)/
│ │ ├── (mobile)/
│ │ ├── onboarding/
│ │ └── share/
│ ├── router/ # React Router config
```

**Step 2: Commit**

```bash
git add .agents/skills/project-overview/SKILL.md
git commit -m "📝 docs: update project-overview skill for new routes structure"
```

---

### Task 13: Final Verification

**Step 1: Run type check**

Run: `bun run type-check`
Expected: PASS

**Step 2: Start SPA dev mode**

Run: `bun run dev:spa`
Expected: Server starts without errors

**Step 3: Verify routes work**

Open the Debug Proxy URL and navigate to different pages.

**Step 4: Final commit**

```bash
git add -A
git status
```

Review all changes and create final commit:

```bash
git commit -m "♻️ refactor: restructure SPA routes to src/routes and src/router

- Move SPA page components from src/app/[variants] to src/routes/
- Move router configurations from src/app/[variants]/router to src/router/
- Keep auth pages in src/app/[variants]/(auth) for SSR
- Update all import paths to use @/routes/
- Update CLAUDE.md and project-overview skill documentation"
```

---

## Success Criteria

- [ ] `src/routes/` contains all SPA page components
- [ ] `src/router/` contains route configurations
- [ ] All import paths updated correctly
- [ ] `bun run type-check` passes
- [ ] `bun run dev:spa` works
- [ ] CLAUDE.md updated
- [ ] project-overview SKILL.md updated

## Rollback

If issues arise:

```bash
git reset --hard HEAD~N # N = number of commits to rollback
```
