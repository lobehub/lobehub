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


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.compose = self.directory / 'docker-compose.yml'
        self.compose.write_text('services: {}\n')
        self.calls = []
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
        self.output = contextlib.redirect_stdout(io.StringIO())
        self.output.__enter__()

    def tearDown(self):
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
                    effective['services'].setdefault(service, {}).update(values)
            stdout = json.dumps(effective).replace('$', '$$')
        elif 'pull' in args:
            status = self.pull_status
        elif 'up' in args:
            status = self.up_status
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
