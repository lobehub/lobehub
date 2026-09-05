import { Buffer } from 'node:buffer';

/**
 * Python helpers executed inside a sandbox to implement the file tools.
 *
 * They only depend on python3 and the standard library, so any provider whose
 * runtime ships Python can reuse them and stay behaviourally identical to the
 * others — the tool contracts in `@lobechat/builtin-tool-cloud-sandbox` are
 * encoded here once rather than reimplemented per provider.
 */

export const scriptPrelude = `
import base64, json, os, re, shutil, glob, fnmatch
from pathlib import Path

def load_args(encoded):
    return json.loads(base64.b64decode(encoded).decode())

def emit(value):
    print(json.dumps(value, ensure_ascii=False))
`;

export const listFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directoryPath') or '.'
    entries = []
    for entry in os.scandir(directory):
        stat = entry.stat()
        entries.append({
            'name': entry.name,
            'path': entry.path,
            'isDirectory': entry.is_dir(),
            'size': stat.st_size,
            'mtime': stat.st_mtime,
        })
    emit({'files': entries, 'totalCount': len(entries)})
`;

export const readFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = args.get('path')
    start = args.get('startLine')
    end = args.get('endLine')
    text = Path(path).read_text(errors='replace')
    lines = text.splitlines(True)
    selected = lines
    if start is not None or end is not None:
        start_idx = max((start or 1) - 1, 0)
        end_idx = end if end is not None else len(lines)
        selected = lines[start_idx:end_idx]
    content = ''.join(selected)
    emit({
        'content': content,
        'filename': os.path.basename(path),
        'charCount': len(content),
        'totalCharCount': len(text),
        'totalLineCount': len(lines),
    })
`;

export const prepareWriteFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    if args.get('createDirectories'):
        path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'')
    emit({'success': True})
`;

export const appendWriteFileChunkScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    chunk = base64.b64decode(args.get('chunk') or '')
    with path.open('ab') as file:
        file.write(chunk)
    emit({'bytesWritten': len(chunk), 'success': True})
`;

export const editFileScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    path = Path(args.get('path'))
    search = args.get('search') or ''
    replace = args.get('replace') or ''
    text = path.read_text(errors='replace')
    count = text.count(search)
    if count == 0:
        emit({'success': False, 'error': 'search text not found', 'replacements': 0})
        return
    new_text = text.replace(search, replace) if args.get('all') else text.replace(search, replace, 1)
    replacements = count if args.get('all') else 1
    path.write_text(new_text)
    emit({'success': True, 'replacements': replacements, 'linesAdded': replace.count('\\n'), 'linesDeleted': search.count('\\n')})
`;

export const searchFilesScript = `${scriptPrelude}
from datetime import datetime

def parse_time(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp()
    except Exception:
        return None

def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    raw_keywords = args.get('keywords') or args.get('keyword') or ''
    keywords = [item.strip() for item in str(raw_keywords).split() if item.strip()]
    raw_file_types = args.get('fileTypes') or args.get('fileType') or []
    if isinstance(raw_file_types, str):
        raw_file_types = [raw_file_types]
    file_types = [item if str(item).startswith('.') else f'.{item}' for item in raw_file_types if str(item).strip()]
    modified_after = parse_time(args.get('modifiedAfter'))
    modified_before = parse_time(args.get('modifiedBefore'))
    content_contains = args.get('contentContains')
    limit = args.get('limit')
    results = []
    for root, _, files in os.walk(directory):
        for name in files:
            if keywords and not all(keyword in name for keyword in keywords):
                continue
            if file_types and not any(name.endswith(file_type) for file_type in file_types):
                continue
            path = os.path.join(root, name)
            try:
                stat = os.stat(path)
            except Exception:
                continue
            if modified_after is not None and stat.st_mtime < modified_after:
                continue
            if modified_before is not None and stat.st_mtime > modified_before:
                continue
            if content_contains:
                try:
                    if str(content_contains) not in Path(path).read_text(errors='replace'):
                        continue
                except Exception:
                    continue
            results.append({'name': name, 'path': path, 'size': stat.st_size, 'mtime': stat.st_mtime})
    sort_by = args.get('sortBy')
    reverse = args.get('sortDirection') == 'desc'
    if sort_by == 'size':
        results.sort(key=lambda item: item.get('size') or 0, reverse=reverse)
    elif sort_by == 'date':
        results.sort(key=lambda item: item.get('mtime') or 0, reverse=reverse)
    else:
        results.sort(key=lambda item: item.get('name') or '', reverse=reverse)
    total = len(results)
    if isinstance(limit, int) and limit > 0:
        results = results[:limit]
    emit({'results': results, 'totalCount': total})
`;

export const moveFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    results = []
    for op in args.get('operations') or []:
        try:
            shutil.move(op.get('source'), op.get('destination'))
            results.append({'source': op.get('source'), 'destination': op.get('destination'), 'success': True})
        except Exception as error:
            results.append({'source': op.get('source'), 'destination': op.get('destination'), 'success': False, 'error': str(error)})
    emit({'results': results, 'successCount': len([r for r in results if r.get('success')])})
`;

export const grepContentScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    pattern = args.get('pattern') or ''
    file_pattern = args.get('filePattern') or '*'
    recursive = args.get('recursive', True)
    regex = re.compile(pattern)
    matches = []
    walker = os.walk(directory) if recursive else [(directory, [], os.listdir(directory))]
    for root, _, files in walker:
        for name in files:
            if not fnmatch.fnmatch(name, file_pattern):
                continue
            path = os.path.join(root, name)
            try:
                with open(path, 'r', errors='replace') as file:
                    for index, line in enumerate(file, 1):
                        if regex.search(line):
                            matches.append({'path': path, 'lineNumber': index, 'line': line.rstrip('\\n')})
            except Exception:
                pass
    emit({'matches': matches, 'totalMatches': len(matches)})
`;

export const globFilesScript = `${scriptPrelude}
def main(encoded):
    args = load_args(encoded)
    directory = args.get('directory') or '.'
    pattern = args.get('pattern') or '*'
    files = glob.glob(os.path.join(directory, pattern), recursive=True)
    emit({'files': files, 'totalCount': len(files)})
`;

/**
 * Wraps a script into a heredoc invocation with base64-encoded arguments, so
 * that argument values never need shell quoting.
 */
export const buildScriptCommand = (script: string, params: Record<string, unknown>): string => {
  const encoded = Buffer.from(JSON.stringify(params)).toString('base64');

  return `python3 - <<'PY'\n${script}\nmain('${encoded}')\nPY`;
};
