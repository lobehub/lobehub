import os
import subprocess

repo = os.path.join(os.environ['USERPROFILE'], 'Projects', 'Mio', 'lobehub')
os.chdir(repo)

print("=== WORKFLOW: righe UPDATE_GITHUB_OWNER / app-update ===")
result = subprocess.run(
    ['git', 'show', 'HEAD:.github/workflows/emaxlele-build.yml'],
    capture_output=True, text=True
)
wf = result.stdout
for l in wf.splitlines():
    ls = l.strip()
    if any(k in ls for k in ['UPDATE_GITHUB_OWNER', 'app-update', 'owner', 'emaxlele', 'target_commitish']):
        print(ls)

print("\n=== UpdaterManager.ts: righe owner/emaxlele ===")
upd_path = os.path.join(repo, 'apps', 'desktop', 'src', 'main', 'updater', 'UpdaterManager.ts')
if os.path.exists(upd_path):
    with open(upd_path, encoding='utf-8') as f:
        for l in f:
            ls = l.strip()
            if any(k in ls for k in ['emaxlele', 'owner', 'github', 'lobehub/lobehub']):
                print(ls)
else:
    print("NON TROVATO")

print("\n=== Patches esistenti ===")
patches_dir = os.path.join(repo, 'fixPatch', 'patches')
for p in sorted(os.listdir(patches_dir)):
    print(p)

print("\n=== Ultimi 5 commit ===")
r = subprocess.run(['git', 'log', '--oneline', '-5'], capture_output=True, text=True)
print(r.stdout)
