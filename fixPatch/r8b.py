import os, subprocess, sys

repo = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub'

outfile = r'C:\Users\emanuele.gallo\Projects\Mio\lobehub\fixPatch\r8_out.txt'
out = open(outfile, 'w', encoding='utf-8', errors='replace')

# 1. Find diffText usages
r = subprocess.run(['git', 'grep', '-rn', 'diffText'], cwd=repo,
    capture_output=True, text=True, encoding='utf-8', errors='replace')
out.write("=== diffText grep ===\n" + r.stdout + "\n")

# 2. Find inspector files 
r2 = subprocess.run(['git', 'ls-files', 'src/features/Conversation/Messages'], cwd=repo,
    capture_output=True, text=True, encoding='utf-8', errors='replace')
out.write("=== Messages files ===\n" + r2.stdout + "\n")

# 3. Look for plugin state rendering
r3 = subprocess.run(['git', 'grep', '-rln', 'pluginState', '--', 'src/features/Conversation/'], cwd=repo,
    capture_output=True, text=True, encoding='utf-8', errors='replace')
out.write("=== pluginState in Conversation features ===\n" + r3.stdout + "\n")

out.close()
sys.stdout.buffer.write(open(outfile, 'rb').read()[:8000])
