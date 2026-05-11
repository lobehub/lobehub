import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

# Update the fixture to reflect the new diffText format (with "diff --git" header)
fixture_path = os.path.join(repo, 'src', 'features', 'DevPanel', 'RenderGallery', 'fixtures', 'lobe-local-system.ts')

with open(fixture_path, encoding='utf-8') as f:
    content = f.read()

OLD = '''      pluginState: {
        diffText:
          "--- a/workspace/src/spa/router/desktopRouter.config.tsx\\n+++ b/workspace/src/spa/router/desktopRouter.config.tsx\\n@@ -1,3 +1,7 @@\\n export const desktopRoutes = [\\n+  {\\n+    path: 'devtools',\\n+  },\\n ];\\n",
      },'''

NEW = '''      pluginState: {
        diffText:
          "diff --git a/workspace/src/spa/router/desktopRouter.config.tsx b/workspace/src/spa/router/desktopRouter.config.tsx\\n--- a/workspace/src/spa/router/desktopRouter.config.tsx\\n+++ b/workspace/src/spa/router/desktopRouter.config.tsx\\n@@ -1,3 +1,7 @@\\n export const desktopRoutes = [\\n+  {\\n+    path: 'devtools',\\n+  },\\n ];\\n",
      },'''

if OLD in content:
    fixed = content.replace(OLD, NEW)
    with open(fixture_path, 'w', encoding='utf-8') as f:
        f.write(fixed)
    sys.stdout.buffer.write(b"SUCCESS: fixture updated\n")
else:
    sys.stdout.buffer.write(b"NOTE: fixture OLD string not found - may already be correct or different format\n")
    # Show the current diffText line in the fixture
    for i, line in enumerate(content.split('\n')):
        if 'diffText' in line:
            sys.stdout.buffer.write(f"  line {i+1}: {line}\n".encode('ascii', errors='replace'))

# Show git status
r = subprocess.run(['git', 'status', '--short'], cwd=repo,
    capture_output=True, text=True, encoding='utf-8', errors='replace')
sys.stdout.buffer.write(b"\nGit status:\n")
sys.stdout.buffer.write(r.stdout.encode('ascii', errors='replace'))
