/**
 * Output a command or a poll may bring back, per stream. The SDK holds a whole
 * exec response in the LobeHub process, so anything bigger is cut inside the
 * computer before it travels.
 */
export const OUTPUT_LIMIT_BYTES = 256 * 1024;

/** The Market service's readFile cap, which `formatFileContent` mirrors. */
export const READ_FILE_LIMIT_CHARS = 500_000;

/**
 * Runs `$1` with its output in files, then prints a header line
 * (`<exit code> <stdout bytes> <stderr bytes>`), stdout, and stderr on
 * stderr. A stream over OUTPUT_LIMIT_BYTES keeps its head and its tail, with
 * the size of what was left out between them.
 */
export const cappedRunner = `d=$(mktemp -d /tmp/lobe-exec.XXXXXX) || exit 125
trap 'rm -rf "$d"' EXIT
trap 'exit 143' INT TERM
sh -c "$1" > "$d/out" 2> "$d/err"
code=$?
cap() {
  size=$(($(wc -c < "$1")))
  if [ "$size" -le ${OUTPUT_LIMIT_BYTES} ]; then cat "$1"; return; fi
  head -c ${OUTPUT_LIMIT_BYTES / 2} "$1"
  printf '\\n\\n[... %s bytes of output left out ...]\\n\\n' $((size - ${OUTPUT_LIMIT_BYTES}))
  tail -c ${OUTPUT_LIMIT_BYTES / 2} "$1"
}
printf '%s %s %s\\n' "$code" $(($(wc -c < "$d/out"))) $(($(wc -c < "$d/err")))
cap "$d/out"
cap "$d/err" >&2
exit "$code"`;

/**
 * The Python half of the boxd provider: the operations that are cheaper as
 * one process inside the computer than as many file API calls from the
 * server — walking a tree, reading a window of a large file, reading a
 * background command's new output, and uploading an export straight from the
 * computer to storage.
 *
 * Run as `python3 -c <script>` with the operation and its JSON arguments in
 * the environment, so nothing a model wrote is interpolated into a command
 * line. Prints one JSON object, kept under OUTPUT_LIMIT_BYTES of content.
 */
export const boxdToolScript = String.raw`
import codecs, fnmatch, glob, json, mimetypes, os, re, sys, time, urllib.error, urllib.request
from datetime import datetime

args = json.loads(os.environ.get('LOBE_BOXD_ARGS') or '{}')
SKIP_DIRS = {'.git'}
OUTPUT_LIMIT = ${OUTPUT_LIMIT_BYTES}
DEFAULT_LIMIT = 500
LINE_LIMIT = 2000


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=False))


class Budget:
    """Keeps a result list under OUTPUT_LIMIT and the requested (or default) count."""

    def __init__(self, default_limit=DEFAULT_LIMIT, key='limit'):
        limit = args.get(key)
        self.limit = limit if isinstance(limit, int) and limit > 0 else default_limit
        self.items = []
        self.used = 0
        self.truncated = False

    def add(self, item, size):
        if len(self.items) >= self.limit or self.used + size > OUTPUT_LIMIT:
            self.truncated = True
            return
        self.items.append(item)
        self.used += size


def walk(directory, recursive=True):
    if os.path.isfile(directory):
        yield directory
        return
    if not recursive:
        for name in sorted(os.listdir(directory)):
            path = os.path.join(directory, name)
            if os.path.isfile(path):
                yield path
        return
    for root, dirs, files in os.walk(directory):
        dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS)
        for name in sorted(files):
            yield os.path.join(root, name)


def is_binary(path):
    try:
        with open(path, 'rb') as file:
            return b'\0' in file.read(1024)
    except OSError:
        return True


def timestamp(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def search():
    keywords = str(args.get('keywords') or args.get('keyword') or '').lower().split()
    types = args.get('fileTypes') or args.get('fileType') or []
    if isinstance(types, str):
        types = [types]
    types = ['.' + str(item).lstrip('.') for item in types if str(item).strip()]
    after = timestamp(args.get('modifiedAfter'))
    before = timestamp(args.get('modifiedBefore'))
    needle = args.get('contentContains')
    results = []
    for path in walk(args.get('directory') or '.'):
        name = os.path.basename(path)
        if keywords and not all(keyword in name.lower() for keyword in keywords):
            continue
        if types and not any(name.endswith(item) for item in types):
            continue
        try:
            stat = os.stat(path)
        except OSError:
            continue
        if (after is not None and stat.st_mtime < after) or (before is not None and stat.st_mtime > before):
            continue
        if needle:
            try:
                with open(path, errors='replace') as file:
                    if str(needle) not in file.read():
                        continue
            except OSError:
                continue
        results.append({
            'modifiedTime': datetime.fromtimestamp(stat.st_mtime).isoformat(),
            'name': name,
            'path': path,
            'size': stat.st_size,
        })
    order = {'date': 'modifiedTime', 'size': 'size'}.get(args.get('sortBy'), 'name')
    results.sort(key=lambda item: item[order], reverse=args.get('sortDirection') == 'desc')
    budget = Budget()
    for item in results:
        budget.add(item, len(item['path']) + 96)
    emit({'results': budget.items, 'totalCount': len(results), 'truncated': budget.truncated})


def expand_braces(pattern):
    match = re.search(r'\{([^{}]*)\}', pattern)
    if not match:
        return [pattern]
    head, tail = pattern[:match.start()], pattern[match.end():]
    return [path for option in match.group(1).split(',') for path in expand_braces(head + option + tail)]


def glob_files():
    directory = args.get('directory') or '.'
    seen = set()
    for pattern in expand_braces(args.get('pattern') or '*'):
        for path in glob.glob(os.path.join(directory, pattern), recursive=True):
            if not SKIP_DIRS.intersection(path.split(os.sep)):
                seen.add(path)
    files = sorted(seen, key=lambda path: os.path.getmtime(path) if os.path.exists(path) else 0, reverse=True)
    budget = Budget(1000)
    for path in files:
        budget.add(path, len(path) + 4)
    emit({'files': budget.items, 'totalCount': len(files), 'truncated': budget.truncated})


def grep():
    flags = re.IGNORECASE if args.get('-i') else 0
    regex = re.compile(args.get('pattern') or '', flags)
    name_pattern = args.get('filePattern') or args.get('glob') or '*'
    mode = args.get('output_mode') or 'content'
    budget = Budget(key='head_limit')
    total = 0
    for path in walk(args.get('directory') or '.', args.get('recursive') is not False):
        if not fnmatch.fnmatch(os.path.basename(path), name_pattern) or is_binary(path):
            continue
        count = 0
        try:
            with open(path, errors='replace') as file:
                for number, line in enumerate(file, 1):
                    if regex.search(line):
                        count += 1
                        if mode == 'content':
                            content = line.rstrip('\n')[:LINE_LIMIT]
                            budget.add({'content': content, 'lineNumber': number, 'path': path}, len(content) + len(path) + 32)
        except OSError:
            continue
        total += count
        if count and mode == 'files_with_matches':
            budget.add(path, len(path) + 4)
        elif count and mode == 'count':
            budget.add(path + ': ' + str(count), len(path) + 16)
    emit({'matches': budget.items, 'totalMatches': total, 'truncated': budget.truncated})


def read():
    """A window of a file too large to bring over whole, cut at a line and at the character cap."""
    path = args['path']
    limit = int(args.get('limit') or ${READ_FILE_LIMIT_CHARS})
    start, end = args.get('startLine'), args.get('endLine')
    first = max(start - 1, 0) if isinstance(start, int) else 0
    stop = end if isinstance(end, int) else None
    parts, used, truncated = [], 0, False
    lines = chars = 0
    with open(path, encoding='utf-8', errors='replace', newline='') as file:
        for index, line in enumerate(file):
            lines = index + 1
            chars += len(line)
            if index < first or (stop is not None and index >= stop) or truncated:
                continue
            if used + len(line) > limit:
                truncated = True
                if not parts:
                    parts.append(line[:limit])
                continue
            parts.append(line)
            used += len(line)
    content = ''.join(parts)
    if truncated:
        content += '\n[Truncated at %d characters. The file has %d lines; read a smaller range with startLine and endLine.]' % (limit, lines)
    emit({
        'charCount': len(content),
        'content': content,
        'filename': os.path.basename(path),
        'totalCharCount': chars,
        'totalLineCount': lines,
        'truncated': truncated,
    })


def read_int(path):
    try:
        with open(path) as file:
            return int(file.read().strip())
    except (OSError, ValueError):
        return None


def whole_characters(data):
    """Drops a UTF-8 sequence cut at the end, so the next poll starts on a whole character."""
    for back in range(1, min(4, len(data)) + 1):
        byte = data[-back]
        if byte & 0xC0 != 0x80:
            need = 1 if byte < 0x80 else 2 if byte >> 5 == 0b110 else 3 if byte >> 4 == 0b1110 else 4
            return data if need <= back else data[:-back]
    return data


def read_new(path, final):
    """At most OUTPUT_LIMIT new bytes; the offset moves only past what is returned."""
    marker = path + '.offset'
    offset = read_int(marker) or 0
    try:
        size = os.path.getsize(path)
        with open(path, 'rb') as file:
            file.seek(offset)
            data = file.read(OUTPUT_LIMIT)
    except OSError:
        size, data = offset, b''
    if not final or offset + len(data) < size:
        data = whole_characters(data)
    with open(marker, 'w') as file:
        file.write(str(offset + len(data)))
    return data.decode('utf-8', 'replace'), offset + len(data) < size


def output():
    directory = args['dir']
    if not os.path.isdir(directory):
        emit({'error': 'Unknown commandId', 'success': False})
        return
    exit_path = os.path.join(directory, 'exit')
    exit_code = read_int(exit_path)
    stdout, more_stdout = read_new(os.path.join(directory, 'stdout'), exit_code is not None)
    stderr, more_stderr = read_new(os.path.join(directory, 'stderr'), exit_code is not None)
    pid = read_int(os.path.join(directory, 'pid'))
    killed = os.path.exists(os.path.join(directory, 'killed'))
    if pid is None:
        # The runner writes its pid first; one still missing after a few seconds never started.
        try:
            alive = time.time() - os.path.getmtime(os.path.join(directory, 'command.sh')) < 10
        except OSError:
            alive = False
    else:
        try:
            os.kill(pid, 0)
            alive = True
        except OSError:
            alive = False
    more = more_stdout or more_stderr
    if more:
        stdout += '\n[More output is waiting: call getCommandOutput again.]'
    result = {
        'newOutput': stdout,
        'output': stdout,
        'running': exit_code is None and not killed and alive,
        'stderr': stderr,
        'success': True,
        'truncated': more,
    }
    if exit_code is not None:
        result['exitCode'] = exit_code
    elif killed:
        result['signal'] = 'SIGTERM'
    elif pid is None and not alive:
        result['error'] = 'The command did not start'
    started = read_int(os.path.join(directory, 'started'))
    if started:
        ended = os.path.getmtime(exit_path) if exit_code is not None else time.time()
        result['durationMs'] = max(int(ended * 1000) - started, 0)
    emit(result)


def export():
    path = args['path']
    with open(path, 'rb') as file:
        data = file.read()
    headers = {str(key): str(value) for key, value in (args.get('headers') or {}).items()}
    mime_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if not any(key.lower() == 'content-type' for key in headers):
        headers['Content-Type'] = mime_type
    request = urllib.request.Request(args['url'], data=data, headers=headers, method='PUT')
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            status = response.status
    except urllib.error.HTTPError as error:
        emit({'error': 'Upload failed with HTTP ' + str(error.code), 'success': False})
        return
    emit({'mimeType': mime_type, 'size': len(data), 'status': status, 'success': True})


OPERATIONS = {'export': export, 'glob': glob_files, 'grep': grep, 'output': output, 'read': read, 'search': search}

try:
    OPERATIONS[os.environ['LOBE_BOXD_OPERATION']]()
except Exception as error:
    emit({'error': type(error).__name__ + ': ' + str(error), 'success': False})
`;
