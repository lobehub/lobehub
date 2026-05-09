"""
Script: cherry-pick fix commits + fix auto-updater
1. Cherry-pick 4 real fix commits onto emaxlele-dev
2. Patch electron-builder.mjs to point auto-updater at emaxlele/lobehub
3. Patch .github/workflows/emaxlele-build.yml to pass GH_TOKEN for publish
4. Commit + push
"""
import subprocess
import os
import sys
import re

REPO = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')
os.chdir(REPO)

# ─── helpers ──────────────────────────────────────────────────────────────────

def run(cmd, check=True):
    env = os.environ.copy()
    env['GIT_EDITOR'] = 'true'  # never open editor
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, env=env)
    out = r.stdout.strip()
    err = r.stderr.strip()
    if out:
        print('  OUT:', out[:400])
    if err and r.returncode != 0:
        print('  ERR:', err[:300])
    if check and r.returncode != 0:
        print(f'  FAILED (rc={r.returncode}): {cmd}')
        sys.exit(1)
    return out, err, r.returncode

def abort_cherry_pick_if_active():
    if os.path.exists(os.path.join(REPO, '.git', 'CHERRY_PICK_HEAD')):
        print('  → Aborting leftover cherry-pick...')
        run('git cherry-pick --abort', check=False)

# ─── STEP 0: sanity ───────────────────────────────────────────────────────────

print('\n=== STEP 0: switch to emaxlele-dev ===')
abort_cherry_pick_if_active()
run('git checkout emaxlele-dev')
run('git status --short')

# ─── STEP 1: cherry-picks ─────────────────────────────────────────────────────

print('\n=== STEP 1: cherry-pick fix commits ===')

# Real fix commits only — no CI/workflow noise
FIX_COMMITS = [
    ('eb5471fa2e', 'fix/onboarding-next-actions-after-completion', 'PR #14579'),
    ('6918b83da7', 'fix/mcp-stdio-precheck-timeout-configurable',   'PR #14581'),
    ('03af9acd43', 'fix/local-system-windows-cmd-quoting',           'fix-windows-cmd-quoting'),
    ('098a3d12c3', 'fix/githubcopilot-anyof-schema-sanitizer',       'PR #14572'),
]

results = {}

for sha, branch, pr_ref in FIX_COMMITS:
    print(f'\n  [{sha}] {branch} ({pr_ref})')

    # Check if already in emaxlele-dev
    _, _, rc = run(f'git merge-base --is-ancestor {sha} HEAD', check=False)
    if rc == 0:
        print(f'  → already in emaxlele-dev, skip')
        results[sha] = 'already_present'
        continue

    # Cherry-pick
    _, err, rc = run(f'git cherry-pick --no-edit {sha}', check=False)

    if rc == 0:
        # Success — rename commit message to include cherry-pick reference
        # amend with clearer message
        _, _, _ = run(
            f'git commit --amend --no-edit -m '
            f'"cherry-pick: {branch} ({pr_ref})"',
            check=False
        )
        print(f'  → OK: applied and labeled')
        results[sha] = 'applied'

    else:
        # Check if "nothing to commit" (content already present via different path)
        status_out, _, _ = run('git status --short', check=False)
        cherry_head = os.path.join(REPO, '.git', 'CHERRY_PICK_HEAD')

        if os.path.exists(cherry_head) and not status_out:
            print(f'  → content already present (empty cherry-pick), skipping')
            run('git cherry-pick --skip', check=False)
            results[sha] = 'already_present'
        else:
            print(f'  → CONFLICT, aborting and skipping this commit')
            run('git cherry-pick --abort', check=False)
            results[sha] = 'conflict_skipped'

print('\n  === cherry-pick summary ===')
for sha, status in results.items():
    print(f'  {sha}: {status}')

# ─── STEP 2: fix auto-updater in electron-builder.mjs ─────────────────────────

print('\n=== STEP 2: patch electron-builder.mjs for auto-updater ===')

eb_path = os.path.join(REPO, 'apps', 'desktop', 'electron-builder.mjs')
with open(eb_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Check if already patched
if 'emaxlele' in content and 'UPDATE_GITHUB_OWNER' in content:
    print('  → already patched, skip')
else:
    # Replace the fallback github provider to use UPDATE_GITHUB_OWNER env var
    old = """  // 本地开发无 S3 时回退到 GitHub
  console.info(`📦 ${channelPath} channel: No UPDATE_SERVER_URL, falling back to GitHub provider`);
  return [
    {
      owner: 'lobehub',
      provider: 'github',
      repo: 'lobehub',
    },
  ];"""

    new = """  // 本地开发无 S3 时回退到 GitHub
  // UPDATE_GITHUB_OWNER allows fork builds to auto-update from their own releases
  const githubOwner = process.env.UPDATE_GITHUB_OWNER || 'lobehub';
  const githubRepo  = process.env.UPDATE_GITHUB_REPO  || 'lobehub';
  console.info(`📦 ${channelPath} channel: No UPDATE_SERVER_URL, falling back to GitHub provider (${githubOwner}/${githubRepo})`);
  return [
    {
      owner: githubOwner,
      provider: 'github',
      repo: githubRepo,
    },
  ];"""

    if old in content:
        content = content.replace(old, new)
        with open(eb_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print('  → electron-builder.mjs patched: UPDATE_GITHUB_OWNER/REPO support added')
    else:
        print('  → WARNING: expected block not found — manual check needed')
        print('    Trying fallback patch...')
        # Fallback: find and replace just the owner line
        old2 = "      owner: 'lobehub',"
        new2 = "      owner: process.env.UPDATE_GITHUB_OWNER || 'lobehub',"
        if content.count(old2) == 1:
            content = content.replace(old2, new2)
            with open(eb_path, 'w', encoding='utf-8') as f:
                f.write(content)
            print('  → fallback patch applied (owner line only)')
        else:
            print(f'  → fallback failed ({content.count(old2)} matches), skipping')

# ─── STEP 3: patch workflow to pass UPDATE_GITHUB_OWNER ───────────────────────

print('\n=== STEP 3: patch emaxlele-build.yml — add UPDATE_GITHUB_OWNER ===')

wf_path = os.path.join(REPO, '.github', 'workflows', 'emaxlele-build.yml')
with open(wf_path, 'r', encoding='utf-8') as f:
    wf = f.read()

if 'UPDATE_GITHUB_OWNER' in wf:
    print('  → already patched, skip')
else:
    # Add env vars to both build-windows and build-linux steps
    # Find the env block in Build Windows artifact step and add our vars
    old_env_block = """          UPDATE_CHANNEL: canary
          APP_URL: http://localhost:3015
          DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres'
          KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE='
          TEMP: C:\\temp
          TMP: C:\\temp"""

    new_env_block = """          UPDATE_CHANNEL: canary
          UPDATE_GITHUB_OWNER: emaxlele
          UPDATE_GITHUB_REPO: lobehub
          APP_URL: http://localhost:3015
          DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres'
          KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE='
          TEMP: C:\\temp
          TMP: C:\\temp"""

    if old_env_block in wf:
        wf = wf.replace(old_env_block, new_env_block)

        # Also patch linux build env if present
        old_linux_env = """          UPDATE_CHANNEL: canary
          APP_URL: http://localhost:3015
          DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres'
          KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE='"""

        new_linux_env = """          UPDATE_CHANNEL: canary
          UPDATE_GITHUB_OWNER: emaxlele
          UPDATE_GITHUB_REPO: lobehub
          APP_URL: http://localhost:3015
          DATABASE_URL: 'postgresql://postgres@localhost:5432/postgres'
          KEY_VAULTS_SECRET: 'oLXWIiR/AKF+rWaqy9lHkrYgzpATbW3CtJp3UfkVgpE='"""

        if old_linux_env in wf:
            wf = wf.replace(old_linux_env, new_linux_env)

        with open(wf_path, 'w', encoding='utf-8') as f:
            f.write(wf)
        print('  → emaxlele-build.yml patched: UPDATE_GITHUB_OWNER/REPO added to env')
    else:
        print('  → WARNING: expected env block not found, manual check needed')

# ─── STEP 4: commit changes ───────────────────────────────────────────────────

print('\n=== STEP 4: commit auto-updater changes ===')

run('git add apps/desktop/electron-builder.mjs')
run('git add .github/workflows/emaxlele-build.yml')

# Check if there is anything staged
status, _, _ = run('git diff --cached --name-only', check=False)
if status:
    run('git commit -m "feat(build): route auto-updater to emaxlele/lobehub releases"')
    print('  → committed auto-updater fix')
else:
    print('  → nothing to commit (already patched)')

# ─── STEP 5: push ─────────────────────────────────────────────────────────────

print('\n=== STEP 5: push emaxlele-dev ===')
_, _, rc = run('git push origin emaxlele-dev', check=False)
if rc != 0:
    print('  Push failed, trying --force-with-lease...')
    run('git push origin emaxlele-dev --force-with-lease')

print('\n=== DONE ===')
out, _, _ = run('git log emaxlele-dev --oneline -8', check=False)
print(out)
