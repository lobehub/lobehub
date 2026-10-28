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
    def test_redacts_credentials_embedded_in_urls(self) -> None:
        value = collector.redact_log_line(
            'Testing proxy with URL: socks5://alice:p%40ssword@127.0.0.1:7890'
        )

        self.assertEqual(
            value,
            'Testing proxy with URL: socks5://[REDACTED]@127.0.0.1:7890',
        )

    def test_indexes_stdout_without_provider_terminal_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            stdout_path = Path(directory) / 'stdout.jsonl'
            write_jsonl(
                stdout_path,
                [
                    {
                        'is_error': True,
                        'result': 'prompt and terminal content must stay omitted',
                        'session_id': 'session-1',
                        'subtype': 'error_during_execution',
                        'type': 'result',
                    },
                    {'thread_id': 'thread-1', 'type': 'turn.failed'},
                    {'type': 'agent_settled'},
                    {'stopReason': 'end_turn', 'type': 'trae_prompt_completed'},
                    {'type': 'step_finish'},
                    {
                        'method': 'session/update',
                        'params': {
                            'sessionId': 'nested-session',
                            'update': {'sessionUpdate': 'response_completed'},
                        },
                    },
                ],
            )

            summary = collector.stdout_summary(stdout_path)

        self.assertEqual(
            summary['eventTypeCounts'],
            {
                'agent_settled': 1,
                'result': 1,
                'session/update': 1,
                'step_finish': 1,
                'trae_prompt_completed': 1,
                'turn.failed': 1,
            },
        )
        self.assertEqual(summary['streamSessionIds'], ['nested-session', 'session-1', 'thread-1'])
        self.assertNotIn('prompt and terminal content', json.dumps(summary))

    def test_discovers_trace_from_nested_native_session(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            trace_root = Path(directory)
            trace_dir = trace_root / 'cursor' / 'trace-1'
            trace_dir.mkdir(parents=True)
            write_json(
                trace_dir / 'meta.json',
                {'agentType': 'cursor', 'stdoutFile': 'stdout.jsonl'},
            )
            write_jsonl(
                trace_dir / 'stdout.jsonl',
                [
                    {
                        'method': 'session/update',
                        'params': {'session': {'sessionId': 'nested-session'}},
                    },
                ],
            )

            matches = collector.discover_trace_dirs(
                trace_root, 'nested-session', {'nested-session'}
            )

        self.assertEqual(matches, [trace_dir])

    def test_selects_newest_topic_and_message_entities(self) -> None:
        topic_id = 'tpc_test'
        message_id = 'msg_test'
        timestamps = (
            (
                'ISO strings',
                '2026-01-01T00:00:00.000Z',
                '2026-01-02T00:00:00.000Z',
                '2026-01-03T00:00:00.000Z',
            ),
            ('epoch milliseconds', 1_767_225_600_000, 1_767_312_000_000, 1_767_398_400_000),
        )
        for label, created_at, stale_at, newest_at in timestamps:
            with self.subTest(timestamp_type=label), tempfile.TemporaryDirectory() as directory:
                database = Path(directory) / 'local-database.sqlite3'
                with sqlite3.connect(database) as connection:
                    connection.execute(
                        'CREATE TABLE local_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)'
                    )
                    newest = {
                        'json': {
                            'data': {
                                'createdAt': created_at,
                                'id': topic_id,
                                'metadata': {'heteroSessionId': 'session-new'},
                                'provider': 'codex',
                                'status': 'failed',
                                'updatedAt': newest_at,
                            },
                            'messages': [
                                {
                                    'createdAt': created_at,
                                    'error': {'message': 'new error'},
                                    'id': message_id,
                                    'role': 'assistant',
                                    'topicId': topic_id,
                                    'updatedAt': newest_at,
                                },
                            ],
                        },
                        'meta': {'v': 1},
                    }
                    stale = {
                        'json': {
                            'data': {
                                'createdAt': created_at,
                                'id': topic_id,
                                'metadata': {'heteroSessionId': 'session-old'},
                                'provider': 'codex',
                                'status': 'processing',
                                'updatedAt': stale_at,
                            },
                            'messages': [
                                {
                                    'createdAt': created_at,
                                    'error': {'message': 'old error'},
                                    'id': message_id,
                                    'role': 'assistant',
                                    'topicId': topic_id,
                                    'updatedAt': stale_at,
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

    def test_collects_redacted_process_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            trace_dir = Path(directory)
            write_json(
                trace_dir / 'meta.json',
                {'agentType': 'claude-code', 'stdoutFile': 'stdout.jsonl'},
            )
            write_json(
                trace_dir / 'process-error.json',
                {
                    'message': 'connect socks5://alice:secret@127.0.0.1:7890 failed',
                    'name': 'Error',
                    'transport': 'claude-sdk',
                },
            )
            (trace_dir / 'stdout.jsonl').write_text('', encoding='utf-8')

            result = collector.collect_trace(trace_dir)

        self.assertEqual(
            result['processError'],
            {
                'message': 'connect socks5://[REDACTED]@127.0.0.1:7890 failed',
                'name': 'Error',
                'transport': 'claude-sdk',
            },
        )

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
            log_file = root / 'main.log'
            log_file.write_text('native session session-1 completed\n', encoding='utf-8')

            output = io.StringIO()
            argv = [
                str(SCRIPT_PATH),
                'latest',
                '--storage-root',
                str(storage_root),
                '--trace-root',
                str(trace_root),
                '--log-file',
                str(log_file),
            ]
            with mock.patch.object(sys, 'argv', argv), contextlib.redirect_stdout(output):
                exit_code = collector.main()
            report = json.loads(output.getvalue())

        self.assertEqual(exit_code, 0)
        self.assertEqual(report['inventory']['tracing']['path'], str(trace_root))
        self.assertEqual(len(report['traces']), 1)
        self.assertEqual(report['traces'][0]['streamSessionIds'], ['session-1'])
        self.assertEqual(
            report['mainLog']['exactMatches'],
            [{'line': 1, 'text': 'native session session-1 completed'}],
        )


if __name__ == '__main__':
    unittest.main()
