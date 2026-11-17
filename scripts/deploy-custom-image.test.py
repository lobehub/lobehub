"""Run with python3 scripts/deploy-custom-image.test.py; Docker is mocked."""
import contextlib
import base64
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
import shutil
import subprocess
import sys
import threading
import copy
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('deploy-custom-image.sh')
SOURCE = SCRIPT.read_text().split("<<'PY'\n", 1)[1].rsplit('\nPY\n', 1)[0]
MODULE = types.ModuleType('deployment_manager')
exec(compile(SOURCE, str(SCRIPT), 'exec'), MODULE.__dict__)


class CallbackRecorder:
    """Local LobeHub stand-in that verifies internal callback signatures."""

    def __init__(self, secret, token, watchdog_status=200):
        self.secret = secret
        self.token = token
        self.watchdog_status = watchdog_status
        self.calls = []
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), self._handler())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def _signature_matches(self, handler, body):
        timestamp, _, mac = handler.headers.get('x-lobe-callback-signature', '').partition('.')
        key = hmac.new(self.secret.encode(), b'lobehub:internal-callback:v1', hashlib.sha256).digest()
        message = json.dumps([timestamp, handler.command, handler.path, body], separators=(',', ':'))
        expected = hmac.new(key, message.encode(), hashlib.sha256).hexdigest()
        return bool(timestamp) and hmac.compare_digest(mac, expected)

    def _handler(self):
        recorder = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get('Content-Length') or 0)).decode()
                recorder.calls.append((self.path, dict(self.headers), body))
                status = 200
                if self.path.endswith('/watchdog'):
                    status = recorder.watchdog_status if recorder._signature_matches(self, body) else 401
                elif self.headers.get('Authorization') != 'Bearer ' + recorder.token:
                    status = 401
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{}')

        return Handler

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *args):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    @property
    def url(self):
        return f'http://127.0.0.1:{self.server.server_port}'


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.compose = self.directory / 'docker-compose.yml'
        self.compose.write_text('services: {}\n')
        self.calls = []
        self.psql = []
        self.pull_status = self.up_status = self.probe_status = 0
        self.base = {'services': {'lobe': {
            'image': 'lobehub/lobehub:latest',
            'environment': {'APP_URL': 'http://server:3210'},
        }}}
        self.patches = [patch.object(MODULE, 'run', self.fake_run),
                        patch.dict(MODULE.os.environ, {}, clear=True)]
        for item in self.patches:
            item.start()
        MODULE.interactive = False
        self.stdout_buf = io.StringIO()
        self.stderr_buf = io.StringIO()
        self.output = contextlib.redirect_stdout(self.stdout_buf)
        self.output.__enter__()
        self.error = contextlib.redirect_stderr(self.stderr_buf)
        self.error.__enter__()

    def tearDown(self):
        self.error.__exit__(None, None, None)
        self.output.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        self.temp.cleanup()

    def fake_run(self, args, capture=False, data=None, check=True):
        args = [str(arg) for arg in args]
        self.calls.append((args, data))
        status, stdout = 0, ''
        if 'config' in args:
            effective = copy.deepcopy(self.base)
            paths = [Path(args[i + 1]) for i, value in enumerate(args) if value == '-f']
            if len(paths) > 1:
                text = paths[-1].read_text()
                if text.startswith(MODULE.MARKER):
                    text = text.split('\n', 1)[1]
                managed = json.loads(text.replace('$$', '$'))
                for service, values in managed['services'].items():
                    target = effective['services'].setdefault(service, {})
                    environment = {**target.get('environment', {}), **values.get('environment', {})}
                    target.update(values)
                    target['environment'] = environment
            stdout = json.dumps(effective).replace('$', '$$')
        elif 'pull' in args:
            status = self.pull_status
        elif 'up' in args:
            status = self.up_status
        elif 'psql' in args:
            stdout = self.psql.pop(0) if self.psql else ''
        elif data == MODULE.ONLYBOXES_PROBE:
            status = self.probe_status
        elif '-e' in args:
            stdout = json.dumps({'private': {'keys': [{'d': 'private'}]},
                                 'public': {'keys': [{'n': 'public'}]}})
        if check and status:
            raise RuntimeError('mock failure')
        return types.SimpleNamespace(returncode=status, stdout=stdout, stderr='')

    def manager(self):
        return MODULE.Manager(self.directory, self.compose)

    def desired(self, provider=None):
        managed = {'services': {'lobe': {'image': MODULE.DEFAULT_IMAGE + ':main'}}}
        if provider:
            managed['services']['lobe']['environment'] = {
                'SANDBOX_PROVIDER': provider,
                'ONLYBOXES_BASE_URL': 'http://onlyboxes:8080',
                'ONLYBOXES_JIT_SIGNING_KEY': 'secret$with$dollars',
            }
        return managed

    def test_main_canary_and_saved_choice(self):
        for choice, tag in [('2', 'main'), ('3', 'canary')]:
            MODULE.interactive = True
            with patch.object(MODULE, 'ask', side_effect=[choice, 'y']):
                self.manager().menu()
            self.assertEqual(self.manager().current['services']['lobe']['image'], MODULE.DEFAULT_IMAGE + ':' + tag)
        MODULE.interactive = False
        self.manager().menu()
        self.assertEqual(self.manager().current['services']['lobe']['image'], MODULE.DEFAULT_IMAGE + ':canary')

    def test_pull_failure_keeps_configuration(self):
        manager = self.manager()
        self.pull_status = 1
        with self.assertRaisesRegex(RuntimeError, '镜像拉取失败'):
            manager.deploy(self.desired())
        self.assertFalse(manager.override.exists())
        self.assertFalse(any('up' in args for args, _ in self.calls))

    def test_update_presets_tfs_without_replacing_existing_secrets(self):
        self.base['services']['lobe']['environment']['KEY_VAULTS_SECRET'] = 'existing-key'
        env_file = self.directory / '.env'
        env_file.write_text('KEY_VAULTS_SECRET=existing-key\n')
        manager = self.manager()
        manager.menu()
        environment = self.manager().current['services']['lobe']['environment']
        self.assertEqual(environment['TFS_COLLECTION_URL'], 'http://dev.tellhowsoft.com/DefaultCollection')
        self.assertEqual(environment['TFS_API_VERSION'], '6.0')
        self.assertEqual(environment['KEY_VAULTS_SECRET'], 'existing-key')
        self.assertEqual(env_file.read_text(), 'KEY_VAULTS_SECRET=existing-key\n')
        self.assertNotIn('KEY_VAULTS_SECRET', manager.override.read_text())

    def test_update_preserves_explicit_tfs_settings_including_disabled(self):
        for collection in ['https://other.example/Collection', '']:
            with self.subTest(collection=collection):
                self.base['services']['lobe']['environment'].update({
                    'TFS_COLLECTION_URL': collection, 'TFS_API_VERSION': '5.0',
                })
                manager = self.manager()
                manager.deploy(self.desired())
                environment = self.manager().current['services']['lobe']['environment']
                self.assertEqual(environment['TFS_COLLECTION_URL'], collection)
                self.assertEqual(environment['TFS_API_VERSION'], '5.0')
                self.assertNotIn('TFS_COLLECTION_URL', manager.override.read_text())

    def test_update_preserves_managed_tfs_settings(self):
        desired = self.desired()
        desired['services']['lobe']['environment'] = {
            'TFS_COLLECTION_URL': 'https://managed.example/Collection', 'TFS_API_VERSION': '5.1',
        }
        self.manager().deploy(desired)
        self.manager().menu()
        environment = self.manager().current['services']['lobe']['environment']
        self.assertEqual(environment['TFS_COLLECTION_URL'], 'https://managed.example/Collection')
        self.assertEqual(environment['TFS_API_VERSION'], '5.1')

    def test_probe_failure_blocks_switch_before_restart(self):
        manager = self.manager()
        manager.deploy(self.desired())
        before = manager.override.read_text()
        self.probe_status = 1
        self.calls.clear()
        with self.assertRaisesRegex(RuntimeError, 'Onlyboxes 检查未通过'):
            manager.deploy(self.desired('onlyboxes'))
        self.assertEqual(manager.override.read_text(), before)
        self.assertFalse(any('up' in args for args, _ in self.calls))

    def test_update_preserves_sandbox_key_and_escapes_dollars(self):
        self.manager().deploy(self.desired('onlyboxes'))
        manager = self.manager()
        original = manager.managed['services']['lobe']['environment']['ONLYBOXES_JIT_SIGNING_KEY']
        self.assertEqual(original, 'secret$with$dollars')
        manager.menu()
        self.assertEqual(self.manager().managed['services']['lobe']['environment']['ONLYBOXES_JIT_SIGNING_KEY'], original)
        self.assertIn('secret$$with$$dollars', manager.override.read_text())
        self.assertEqual(manager.override.stat().st_mode & 0o777, 0o600)

    def test_start_failure_restores_override(self):
        manager = self.manager()
        manager.deploy(self.desired())
        before = manager.override.read_text()
        self.up_status = 1
        with self.assertRaisesRegex(RuntimeError, '部署未完成'):
            manager.deploy(self.desired('onlyboxes'))
        self.assertEqual(manager.override.read_text(), before)

    def test_cancel_does_not_pull_or_write(self):
        MODULE.interactive = True
        manager = self.manager()
        with patch.object(MODULE, 'ask', return_value='n'):
            manager.deploy(self.desired())
        self.assertFalse(manager.override.exists())
        self.assertFalse(any('pull' in args for args, _ in self.calls))

    def test_user_override_is_never_overwritten(self):
        (self.directory / 'docker-compose.override.yml').write_text('services: {}\n')
        with self.assertRaisesRegex(RuntimeError, '已有覆盖文件'):
            self.manager()

    def test_market_clears_onlyboxes_settings(self):
        manager = self.manager()
        managed = self.desired('onlyboxes')
        with patch.object(MODULE, 'ask', return_value='3'):
            manager.select_sandbox(managed)
        env = managed['services']['lobe']['environment']
        self.assertEqual(env['SANDBOX_PROVIDER'], 'market')
        self.assertEqual(env['ONLYBOXES_JIT_SIGNING_KEY'], '')

    def test_new_install_generates_secrets_and_starts_dependencies(self):
        self.compose.unlink()
        MODULE.interactive = True
        repo = SCRIPT.parent.parent
        answers = [MODULE.DEFAULT_IMAGE, '1', 'http://10.10.10.118:3210', '3210',
                   'http://10.10.10.118:8787', 'http://10.10.10.118:8788',
                   'http://10.10.10.118:9000', 'y', '1', 'y']
        def download(url):
            name = url.split('/docker-compose/deploy/')[1]
            return (repo / 'docker-compose/deploy' / name).read_text()
        with patch.object(MODULE, 'ask', side_effect=answers), \
                patch.object(MODULE, 'download', side_effect=download), \
                patch.object(MODULE.socket, 'socket'):
            MODULE.new_install(self.directory)
        env = (self.directory / '.env').read_text()
        self.assertNotIn('YOUR_', env)
        self.assertIn("APP_URL='http://10.10.10.118:3210'", env)
        self.assertIn("TFS_COLLECTION_URL='http://dev.tellhowsoft.com/DefaultCollection'", env)
        self.assertIn("TFS_API_VERSION='6.0'", env)
        vault_key = next(line.split('=', 1)[1].strip("'") for line in env.splitlines()
                         if line.startswith('KEY_VAULTS_SECRET='))
        self.assertEqual(len(base64.b64decode(vault_key)), 32)
        self.assertEqual((self.directory / '.env').stat().st_mode & 0o777, 0o600)
        up = next(args for args, _ in self.calls if 'up' in args)
        self.assertNotIn('--no-deps', up)
        self.assertTrue((self.directory / 'elasticsearch/Dockerfile').exists())

    def test_reinstall_refuses_existing_data(self):
        MODULE.interactive = True
        with self.assertRaisesRegex(RuntimeError, '首次安装目录必须为空'):
            MODULE.new_install(self.directory)

    def test_reject_invalid_onlyboxes_url(self):
        for url in ['file:///tmp/service', 'http://user:password@host', 'http://host/\nfoo']:
            with self.assertRaises((RuntimeError, ValueError)):
                MODULE.validate_url(url)

    def settle_fixture(self, recorder):
        """A deployment with PostgreSQL published on 5432 and a local API stand-in."""
        self.base['services']['postgresql'] = {
            'image': 'postgres:17',
            'ports': [{'mode': 'ingress', 'target': 5432, 'published': '5432'}],
            'environment': {'POSTGRES_DB': 'lobechat'},
        }
        self.base['services']['lobe']['environment'].update({
            'KEY_VAULTS_SECRET': 'vault-secret',
            'AGENT_GATEWAY_SERVICE_TOKEN': 'service-token',
            'INTERNAL_APP_URL': recorder.url,
        })

    def psql_statements(self):
        return [args[args.index('-c') + 1] for args, _ in self.calls if 'psql' in args]

    def test_deploy_settles_interrupted_runs_and_residual_chats(self):
        with CallbackRecorder('vault-secret', 'service-token') as recorder:
            self.settle_fixture(recorder)
            # 3 in-flight ops, 2 attached to a running task, then the left-over chat op.
            self.psql = ['3\n', '2\n', '1\n', '1\n', 'op_task_1\nop_task_2\n', '0\n', '0\n', 'op_chat\n']
            self.manager().deploy(self.desired())
        statements = self.psql_statements()
        self.assertTrue(statements[4].startswith('UPDATE agent_operations'))
        self.assertIn("status = 'interrupted'", statements[4])
        self.assertIn("interval '20 minutes'", statements[4])
        self.assertIn("WHERE status = 'running'", statements[4])
        self.assertEqual([call[0] for call in recorder.calls],
                         ['/api/workflows/task/watchdog', '/api/agent/finalize-abandoned'])
        self.assertEqual(json.loads(recorder.calls[1][2]),
                         {'operationId': 'op_chat', 'reason': 'deploy'})
        self.assertEqual(recorder.calls[1][1]['Authorization'], 'Bearer service-token')
        output = self.stdout_buf.getvalue()
        self.assertIn('已把 2 个运行中的操作标记为 interrupted', output)
        self.assertIn('残留的聊天操作：已结算 1 个，失败 0 个', output)

    def test_deploy_survives_watchdog_rejection(self):
        with CallbackRecorder('vault-secret', 'service-token', watchdog_status=503) as recorder:
            self.settle_fixture(recorder)
            self.psql = ['3\n', '2\n', '1\n', '1\n', 'op_task_1\n', '1\n', '1\n', 'op_chat\n']
            self.manager().deploy(self.desired())
        self.assertIn('警告：任务看护返回 HTTP 503', self.stderr_buf.getvalue())
        self.assertEqual(len(recorder.calls), 2)
        self.assertIn('部署完成', self.stdout_buf.getvalue())

    def test_settle_can_be_disabled_or_previewed(self):
        for value, statements, calls in [('0', 0, 0), ('dry-run', 4, 0), ('off', 0, 0)]:
            with self.subTest(setting=value):
                with CallbackRecorder('vault-secret', 'service-token') as recorder:
                    self.settle_fixture(recorder)
                    self.psql = ['3\n', '2\n', '1\n', '1\n']
                    MODULE.os.environ['SETTLE'] = value
                    self.calls.clear()
                    self.manager().deploy(self.desired())
                    self.assertEqual(len(self.psql_statements()), statements)
                    self.assertEqual(len(recorder.calls), calls)
                    if value == 'dry-run':
                        self.assertIn('SETTLE=dry-run', self.stdout_buf.getvalue())
                    self.assertFalse(any('UPDATE' in item for item in self.psql_statements()))
                self.base['services']['lobe']['environment'].pop('INTERNAL_APP_URL')


@unittest.skipUnless(shutil.which('node'), 'Node.js unavailable; protocol contract tested in CI')
class OnlyboxesProtocolTests(unittest.TestCase):
    def test_probe_checks_jit_signature_worker_and_auth_failure(self):
        calls = []
        key = 'contract-test-secret'

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                token = self.headers.get('Authorization', '').removeprefix('Bearer ')
                signed, signature = token.rsplit('.', 1)
                expected = base64.urlsafe_b64encode(hmac.new(key.encode(), signed.encode(), hashlib.sha256).digest()).decode().rstrip('=')
                payload = signed.removeprefix('obx_jit_v1.')
                claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                calls.append((self.path, claims, body))
                if signature != expected:
                    self.send_response(401)
                    self.end_headers()
                    self.wfile.write(b'{}')
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"exit_code":0,"stdout":"lobehub-onlyboxes-ok"}')

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            env = {**os.environ, 'ONLYBOXES_BASE_URL': f'http://127.0.0.1:{server.server_port}',
                   'ONLYBOXES_JIT_SIGNING_KEY': key, 'ONLYBOXES_JIT_ISSUER': 'test-issuer'}
            for secret, success in [(key, True), ('wrong-key', False)]:
                result = subprocess.run(['node', '-'], input=MODULE.ONLYBOXES_PROBE,
                                        env={**env, 'ONLYBOXES_JIT_SIGNING_KEY': secret},
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode == 0, success, result.stderr)
                self.assertNotIn(secret, result.stdout + result.stderr)
            path, claims, body = calls[0]
            self.assertEqual(path, '/api/v1/commands/terminal')
            self.assertEqual(claims['iss'], 'test-issuer')
            self.assertEqual(body['session_id'], claims['sub'])
            self.assertEqual(body['lease_ttl_sec'], 60)
            self.assertTrue(body['create_if_missing'])
        finally:
            server.shutdown()
            server.server_close()
            worker.join()


def compose_check():
    case = DeploymentTests('test_new_install_generates_secrets_and_starts_dependencies')
    case.setUp()
    try:
        case.test_new_install_generates_secrets_and_starts_dependencies()
        for item in reversed(case.patches):
            item.stop()
        case.patches.clear()
        override = case.directory / 'docker-compose.override.yml'
        config = json.loads(subprocess.check_output([
            'docker', 'compose', '--project-directory', str(case.directory),
            '-f', str(case.compose), '-f', str(override), 'config', '--format', 'json'], text=True).replace('$$', '$'))
        service = config['services']['lobe']
        assert service['image'] == MODULE.DEFAULT_IMAGE + ':main'
        assert service['environment']['APP_URL'] == 'http://10.10.10.118:3210'
        assert service['environment']['TFS_COLLECTION_URL'] == 'http://dev.tellhowsoft.com/DefaultCollection'
        assert service['environment']['TFS_API_VERSION'] == '6.0'
        assert len(base64.b64decode(service['environment']['KEY_VAULTS_SECRET'])) == 32
        json.loads(service['environment']['JWKS_KEY'])
        assert all('YOUR_' not in str(value) for value in service['environment'].values())
        managed = case.desired('onlyboxes')
        with override.open('w') as stream:
            stream.write(MODULE.MARKER + '\n' + json.dumps(managed).replace('$', '$$'))
        config = json.loads(subprocess.check_output([
            'docker', 'compose', '--project-directory', str(case.directory),
            '-f', str(case.compose), '-f', str(override), 'config', '--format', 'json'], text=True).replace('$$', '$'))
        assert config['services']['lobe']['environment']['ONLYBOXES_JIT_SIGNING_KEY'] == 'secret$with$dollars'
    finally:
        case.tearDown()
    print('PASS: real Compose parsing, generated secrets, JWKS JSON, Onlyboxes key interpolation')


if __name__ == '__main__':
    if sys.argv[1:] == ['--compose-check']:
        compose_check()
    else:
        unittest.main()
