import os, sys

base = os.path.join(
    os.environ.get('USERPROFILE', 'C:\\Users\\emanuele.gallo'), 'Projects', 'Mio', 'lobehub', 'src',
    'routes', '(main)', 'agent', 'features', 'Conversation',
    'WorkingSidebar', 'Review'
)

sys.stdout.write(f"BASE: {base}\n")
sys.stdout.write(f"EXISTS: {os.path.exists(base)}\n")

if os.path.exists(base):
    for fname in os.listdir(base):
        fpath = os.path.join(base, fname)
        sys.stdout.write(f"\n=== {fname} ===\n")
        try:
            with open(fpath, encoding='utf-8') as f:
                sys.stdout.write(f.read())
        except Exception as e:
            sys.stdout.write(f"ERROR: {e}\n")
sys.stdout.flush()
