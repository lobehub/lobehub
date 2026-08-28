from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name('collect-local-run.py')
SPEC = importlib.util.spec_from_file_location('collect_local_run', SCRIPT_PATH)
assert SPEC and SPEC.loader
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value), encoding='utf-8')


def write_jsonl(path: Path, values: list[object]) -> None:
    path.write_text('\n'.join(json.dumps(value) for value in values) + '\n', encoding='utf-8')


class CollectLocalRunTest(unittest.TestCase):
    def test_reads_claude_error_from_result(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stdout_path = Path(directory) / 'stdout.jsonl'
            write_jsonl(
                stdout_path,
                [
                    {
                        'is_error': True,
                        'result': 'API Error: connection reset',
                        'session_id': 'session-1',
                        'subtype': 'error_during_execution',
                        'type': 'result',
                    },
                ],
            )

            summary = collector.protocol_summary(stdout_path)

        self.assertEqual(summary['terminalResults'][0]['error'], 'API Error: connection reset')

    def test_reads_claude_error_from_errors_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stdout_path = Path(directory) / 'stdout.jsonl'
            write_jsonl(
                stdout_path,
                [
                    {
                        'errors': ['No conversation found with session ID: session-1'],
                        'is_error': True,
                        'result': '',
                        'session_id': 'session-1',
                        'subtype': 'error_during_execution',
                        'type': 'result',
                    },
                ],
            )

            summary = collector.protocol_summary(stdout_path)

        self.assertEqual(summary['streamSessionIds'], ['session-1'])
        self.assertEqual(
            summary['terminalResults'][0]['error'],
            'No conversation found with session ID: session-1',
        )

    def test_reads_codex_sessions_and_terminal_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            trace_root = Path(directory)
            trace_dir = trace_root / 'codex' / 'trace-1'
            trace_dir.mkdir(parents=True)
            write_json(
                trace_dir / 'meta.json',
                {'agentType': 'codex', 'stdoutFile': 'stdout.jsonl'},
            )
            write_jsonl(
                trace_dir / 'stdout.jsonl',
                [
                    {'thread_id': 'thread-1', 'type': 'thread.started'},
                    {'message': 'Reconnecting... 1/1', 'type': 'error'},
                    {'error': {'message': 'Service unavailable'}, 'type': 'turn.failed'},
                ],
            )

            matches = collector.discover_trace_dirs(trace_root, 'thread-1', {'thread-1'})
            summary = collector.protocol_summary(trace_dir / 'stdout.jsonl')

        self.assertEqual(matches, [trace_dir])
        self.assertEqual(summary['streamSessionIds'], ['thread-1'])
        self.assertEqual(
            [result['eventType'] for result in summary['terminalResults']],
            ['error', 'turn.failed'],
        )
        self.assertEqual(summary['terminalResults'][-1]['error'], 'Service unavailable')
        self.assertTrue(all(result['sessionId'] == 'thread-1' for result in summary['terminalResults']))

    def test_selects_newest_topic_and_message_entities(self) -> None:
        topic_id = 'tpc_test'
        message_id = 'msg_test'
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'local-database.sqlite3'
            with sqlite3.connect(database) as connection:
                connection.execute('CREATE TABLE local_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
                newest = {
                    'json': {
                        'data': {
                            'createdAt': '2026-01-01T00:00:00.000Z',
                            'id': topic_id,
                            'metadata': {'heteroSessionId': 'session-new'},
                            'provider': 'codex',
                            'status': 'failed',
                            'updatedAt': '2026-01-03T00:00:00.000Z',
                        },
                        'messages': [
                            {
                                'createdAt': '2026-01-01T00:00:00.000Z',
                                'error': {'message': 'new error'},
                                'id': message_id,
                                'role': 'assistant',
                                'topicId': topic_id,
                                'updatedAt': '2026-01-03T00:00:00.000Z',
                            },
                        ],
                    },
                    'meta': {'v': 1},
                }
                stale = {
                    'json': {
                        'data': {
                            'createdAt': '2026-01-01T00:00:00.000Z',
                            'id': topic_id,
                            'metadata': {'heteroSessionId': 'session-old'},
                            'provider': 'codex',
                            'status': 'processing',
                            'updatedAt': '2026-01-02T00:00:00.000Z',
                        },
                        'messages': [
                            {
                                'createdAt': '2026-01-01T00:00:00.000Z',
                                'error': {'message': 'old error'},
                                'id': message_id,
                                'role': 'assistant',
                                'topicId': topic_id,
                                'updatedAt': '2026-01-02T00:00:00.000Z',
                            },
                        ],
                    },
                    'meta': {'v': 1},
                }
                connection.executemany(
                    'INSERT INTO local_records (id, value) VALUES (?, ?)',
                    [('new-first', json.dumps(newest)), ('stale-last', json.dumps(stale))],
                )

            result = collector.collect_topic_cache(database, topic_id)

        self.assertEqual(result['topic']['status'], 'failed')
        self.assertEqual(result['nativeSessionIds'], ['session-new'])
        self.assertEqual(result['errors'][0]['error']['message'], 'new error')

    def test_main_accepts_development_trace_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            storage_root = root / 'storage'
            trace_root = root / '.heerogeneous-tracing'
            trace_dir = trace_root / 'amp' / 'trace-1'
            trace_dir.mkdir(parents=True)
            (trace_root / '.last-live-trace').write_text(str(trace_dir), encoding='utf-8')
            write_json(
                trace_dir / 'meta.json',
                {
                    'agentType': 'amp',
                    'createdAt': '2026-01-01T00:00:00.000Z',
                    'sessionId': 'process-1',
                    'stdoutFile': 'stdout.jsonl',
                },
            )
            write_json(trace_dir / 'exit.json', {'code': 0})
            write_jsonl(
                trace_dir / 'stdout.jsonl',
                [
                    {
                        'is_error': False,
                        'session_id': 'session-1',
                        'subtype': 'success',
                        'type': 'result',
                    },
                ],
            )

            output = io.StringIO()
            argv = [
                str(SCRIPT_PATH),
                'latest',
                '--storage-root',
                str(storage_root),
                '--trace-root',
                str(trace_root),
                '--log-file',
                str(root / 'missing.log'),
            ]
            with mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(output):
                exit_code = collector.main()
            report = json.loads(output.getvalue())

        self.assertEqual(exit_code, 0)
        self.assertEqual(report['inventory']['tracing']['path'], str(trace_root))
        self.assertEqual(len(report['traces']), 1)
        self.assertEqual(report['traces'][0]['streamSessionIds'], ['session-1'])


if __name__ == '__main__':
    unittest.main()
