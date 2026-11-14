#!/usr/bin/env bash
set -Eeuo pipefail

# Standalone installer/manager. Download this file, then run it with bash.
# New Linux machines: sudo bash deploy-custom-image.sh
# Existing deployments: cd /root/lobehub && bash deploy-custom-image.sh
# Automation: TAG=main bash deploy-custom-image.sh --non-interactive
if ! command -v python3 >/dev/null 2>&1; then
  if [[ "${1:-}" == --non-interactive || ! -t 0 ]]; then
    echo '请先安装 Python 3，再运行脚本。' >&2
    exit 1
  fi
  if [[ $EUID != 0 ]] || ! command -v apt-get >/dev/null 2>&1; then
    echo '请先安装 Python 3；Ubuntu/Debian 可执行 sudo apt-get install python3。' >&2
    exit 1
  fi
  read -r -p '需要安装 Python 3，是否使用 apt 安装？[y/N]：' answer
  [[ "$answer" == y || "$answer" == Y ]] || exit 0
  apt-get update
  apt-get install -y python3 ca-certificates
fi
export LOBEHUB_MANAGER_SCRIPT_PATH="${BASH_SOURCE[0]}"
export LOBEHUB_MANAGER_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$@" <<'PY'
import argparse
import base64
import contextlib
import copy
import datetime
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request

MARKER = '# Managed by deploy-custom-image.sh'
COMPOSE_NAMES = ('compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml')
OVERRIDE_NAMES = ('compose.override.yaml', 'compose.override.yml',
                  'docker-compose.override.yaml', 'docker-compose.override.yml')
DEFAULT_IMAGE = 'ghcr.io/lichao0223/lobehub'
SANDBOX_KEYS = ('SANDBOX_PROVIDER', 'ONLYBOXES_BASE_URL', 'ONLYBOXES_JIT_SIGNING_KEY',
                'ONLYBOXES_JIT_ISSUER', 'ONLYBOXES_JIT_TTL_SEC', 'ONLYBOXES_LEASE_TTL_SEC')

# Matches the token and terminal request used by the Onlyboxes provider.
# This runs inside a one-off LobeHub container on the deployment's network.
ONLYBOXES_PROBE = r'''
const crypto = require('node:crypto');
(async () => {
  const env = process.env;
  const base = (env.ONLYBOXES_BASE_URL || '').replace(/\/+$/, '');
  const key = env.ONLYBOXES_JIT_SIGNING_KEY;
  if (!base || !key) throw Error('Onlyboxes 地址或签名密钥缺失');
  const sub = 'lobehub-deploy-check-' + crypto.randomUUID();
  const claims = {exp: Date.now() + 60000,
    iss: env.ONLYBOXES_JIT_ISSUER || env.APP_URL || 'lobehub', sub};
  const signed = 'obx_jit_v1.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
  const token = signed + '.' + crypto.createHmac('sha256', key).update(signed).digest('base64url');
  const response = await fetch(base + '/api/v1/commands/terminal', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000),
    headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
    body: JSON.stringify({command: 'printf lobehub-onlyboxes-ok',
      create_if_missing: true, lease_ttl_sec: 60, session_id: sub, timeout_ms: 30000})
  });
  if (!response.ok) throw Error('Onlyboxes HTTP ' + response.status +
    '；检查 Console 地址、签名密钥、issuer 和 worker 状态');
  const result = await response.json();
  if (result.exit_code !== 0 || result.stdout !== 'lobehub-onlyboxes-ok')
    throw Error('Onlyboxes 没有成功执行探测命令；检查 terminalExec worker');
  console.log('Onlyboxes 检查通过：容器网络、JIT 认证、terminalExec worker 可用。');
})().catch(e => { console.error('Onlyboxes 检查失败：' + e.message); process.exit(1); });
'''

JWKS_SCRIPT = r'''
const c = require('node:crypto');
const {privateKey, publicKey} = c.generateKeyPairSync('rsa', {modulusLength:2048});
const meta = {alg:'RS256', kid:c.randomBytes(8).toString('hex'), use:'sig'};
console.log(JSON.stringify({private:{keys:[{...privateKey.export({format:'jwk'}),...meta}]},
  public:{keys:[{...publicKey.export({format:'jwk'}),...meta}]}}));
'''


def fail(message):
    raise RuntimeError(message)


def run(args, capture=False, data=None, check=True):
    result = subprocess.run([str(arg) for arg in args], input=data, text=True,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None)
    if check and result.returncode:
        # Captured Compose config can contain secrets. Never echo its output.
        fail('命令执行失败：' + ' '.join(str(arg) for arg in args[:3]))
    return result


def ask(label, default='', secret=False):
    if not interactive:
        return default
    with open('/dev/tty', 'r+') as tty:
        prompt = label + (f' [{default}]' if default and not secret else '') + '：'
        if secret:
            return getpass.getpass(prompt, stream=tty) or default
        tty.write(prompt)
        tty.flush()
        answer = tty.readline()
        if not answer:
            fail('终端输入已关闭。')
        return answer.strip() or default


def confirm(message):
    return not interactive or ask(message + ' [y/N]').lower() in ('y', 'yes')


def write_private(path, content):
    # Atomic replacement; keys and database credentials are owner-readable only.
    fd, name = tempfile.mkstemp(prefix='.lobehub-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(content)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def find_compose(directory):
    return next((directory / name for name in COMPOSE_NAMES if (directory / name).is_file()), None)


def check_docker():
    if not shutil.which('docker'):
        if not interactive or sys.platform != 'linux' or os.geteuid() != 0:
            fail('未安装 Docker。Ubuntu/Debian 新机器请使用 sudo bash 运行本脚本安装。')
        release = Path('/etc/os-release').read_text()
        if not re.search(r'^ID=(?:"?)(ubuntu|debian)(?:"?)$', release, re.M):
            fail('自动安装 Docker 仅支持 Ubuntu/Debian；其他系统请先安装 Docker Engine 和 Compose 插件。')
        if not confirm('未安装 Docker，是否通过 Docker 官方安装脚本安装 Engine 和 Compose'):
            fail('已取消 Docker 安装。')
        run(['apt-get', 'update'])
        run(['apt-get', 'install', '-y', 'ca-certificates', 'curl'])
        with tempfile.TemporaryDirectory() as temp:
            installer = Path(temp) / 'get-docker.sh'
            run(['curl', '-fsSL', '--connect-timeout', '15', '--max-time', '120',
                 'https://get.docker.com', '-o', installer])
            run(['sh', installer])
        run(['systemctl', 'enable', '--now', 'docker'])
    run(['docker', 'compose', 'version'], capture=True)
    result = run(['docker', 'info'], capture=True, check=False)
    if result.returncode:
        fail('Docker daemon 未启动或当前用户无权限，请启动 Docker 或使用 sudo。')


def validate_image(image, tag):
    if not re.fullmatch(r'[a-z0-9][a-z0-9./:_-]*', image):
        fail('镜像仓库格式无效，仓库和标签请分开填写。')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}', tag):
        fail('镜像标签无效。')
    return image + ':' + tag


def validate_url(value):
    if any(ord(char) < 33 for char in value):
        fail('地址不能包含空格或控制字符。')
    parsed = urllib.parse.urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.query or parsed.fragment):
        fail('请输入完整 HTTP/HTTPS 地址，不要包含用户名、密码、查询参数。')
    # Accessing port checks its syntax/range as well.
    parsed.port
    return parsed


class Manager:
    def __init__(self, directory, compose):
        self.directory = directory.resolve()
        self.compose = compose.resolve()
        self.service = os.environ.get('SERVICE', 'lobe')
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', self.service):
            fail('服务名格式无效。')
        name = 'compose.override.yaml' if self.compose.name.startswith('compose.') else 'docker-compose.override.yml'
        self.override = self.directory / name
        for other in OVERRIDE_NAMES:
            path = self.directory / other
            if path.exists() and (path != self.override or not path.read_text().startswith(MARKER + '\n')):
                fail(f'发现已有覆盖文件 {path}。为保留你的配置，脚本没有修改它。')
        self.managed = {'services': {self.service: {}}}
        if self.override.exists():
            text = self.override.read_text().split('\n', 1)[1]
            if text.lstrip().startswith('{'):
                self.managed = json.loads(text.replace('$$', '$'))
                if set(self.managed.get('services', {})) != {self.service}:
                    fail('已保存的应用服务名与 SERVICE 不一致。')
            else:
                # Migrate the previous image-only YAML override.
                match = re.search(r'^    image: "([^"]+)"$', text, re.M)
                if not match:
                    fail('无法识别已有的托管覆盖文件。')
                self.managed['services'][self.service]['image'] = match.group(1)
        self.current = self.config(self.override if self.override.exists() else None)
        if self.service not in self.current['services']:
            fail(f'Compose 没有 {self.service} 服务，请通过 SERVICE 指定应用服务名。')

    def command(self, override=None):
        command = ['docker', 'compose', '--project-directory', str(self.directory), '-f', str(self.compose)]
        if override:
            command += ['-f', str(override)]
        return command

    def config(self, override=None):
        # Compose re-escapes literal dollars when serializing config for reuse.
        output = run(self.command(override) + ['config', '--format', 'json'], capture=True).stdout
        return json.loads(output.replace('$$', '$'))

    @contextlib.contextmanager
    def staged(self, managed):
        fd, name = tempfile.mkstemp(prefix='.lobehub-compose-', suffix='.json', dir=self.directory)
        try:
            with os.fdopen(fd, 'w') as stream:
                # Compose interpolates $, including in JSON/YAML strings.
                stream.write(json.dumps(managed, indent=2).replace('$', '$$') + '\n')
            yield Path(name)
        finally:
            os.unlink(name)

    def sandbox_environment(self):
        return self.current['services'][self.service].get('environment', {})

    def select_sandbox(self, managed):
        print('\n1) 保持当前沙盒设置\n2) 切换到自己的 Onlyboxes\n3) 切回 Market')
        choice = ask('请选择', '1')
        if choice == '1':
            return
        env = managed['services'][self.service].setdefault('environment', {})
        if choice == '3':
            env.update({key: '' for key in SANDBOX_KEYS})
            env['SANDBOX_PROVIDER'] = 'market'
            return
        if choice != '2':
            fail('无效选项。')
        current = self.sandbox_environment()
        url = ask('Onlyboxes Console 地址（不含 /api/v1）', current.get('ONLYBOXES_BASE_URL', '')).rstrip('/')
        parsed = validate_url(url)
        if parsed.path.endswith('/api/v1'):
            fail('请填写 Console 基础地址，不包含 /api/v1。')
        if parsed.hostname in ('localhost', '127.0.0.1', '::1'):
            fail('该地址会指向 LobeHub 容器自身，请使用内网 IP 或容器可访问的服务域名。')
        print('签名密钥必须等于 Onlyboxes Console 的 CONSOLE_JIT_SIGNING_KEY。')
        key = ask('签名密钥（输入隐藏；已有密钥可回车保留）', current.get('ONLYBOXES_JIT_SIGNING_KEY', ''), secret=True)
        if not key:
            fail('签名密钥不能为空。')
        issuer = ask('JIT issuer', current.get('ONLYBOXES_JIT_ISSUER') or current.get('APP_URL') or 'lobehub')
        env.update({'SANDBOX_PROVIDER': 'onlyboxes', 'ONLYBOXES_BASE_URL': url,
                    'ONLYBOXES_JIT_SIGNING_KEY': key, 'ONLYBOXES_JIT_ISSUER': issuer,
                    'ONLYBOXES_JIT_TTL_SEC': '1800', 'ONLYBOXES_LEASE_TTL_SEC': '900'})

    def probe(self, staged):
        print('从 LobeHub 容器网络检查 Onlyboxes，将创建一个短租期测试会话……')
        result = run(self.command(staged) + ['run', '--rm', '--no-deps', '-T',
                     '--entrypoint', '/bin/node', self.service, '-'], data=ONLYBOXES_PROBE, check=False)
        if result.returncode:
            fail('Onlyboxes 检查未通过：请先部署 Console 和 worker，检查网络、JIT 密钥及 terminalExec 能力，再重试。尚未切换配置。')

    def check_onlyboxes(self):
        env = self.sandbox_environment()
        if env.get('SANDBOX_PROVIDER') != 'onlyboxes':
            fail('当前没有选择 Onlyboxes；请先从“切换沙盒”菜单填写地址和密钥。')
        self.probe(self.override if self.override.exists() else None)

    def deploy(self, managed, fresh=False):
        with self.staged(managed) as staged:
            candidate = self.config(staged)
            service = candidate['services'][self.service]
            print('\n目标镜像：' + service['image'])
            print('沙盒：' + service.get('environment', {}).get('SANDBOX_PROVIDER', 'market'))
            if not confirm('确认拉取镜像并启动' + ('完整部署' if fresh else '应用服务')):
                print('已取消，配置未改变。')
                return
            result = run(self.command(staged) + ['pull', self.service], check=False)
            if result.returncode:
                fail('镜像拉取失败，配置未改变。请确认分支镜像构建成功；私有包请 docker login ghcr.io。')
            if service.get('environment', {}).get('SANDBOX_PROVIDER') == 'onlyboxes':
                self.probe(staged)
            backup = self.directory / 'backups' / (datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + secrets.token_hex(3))
            backup.mkdir(parents=True, mode=0o700)
            for path in (self.compose, self.directory / '.env', self.override):
                if path.exists():
                    target = backup / path.name
                    shutil.copyfile(path, target)
                    target.chmod(0o600)
            old_override = self.override.read_text() if self.override.exists() else None
            write_private(self.override, MARKER + '\n' + json.dumps(managed, indent=2).replace('$', '$$') + '\n')
            command = self.command(self.override) + ['up', '-d', '--wait', '--wait-timeout', '300']
            if not fresh:
                command += ['--no-deps', self.service]
            result = run(command, check=False)
            if result.returncode:
                if old_override is None:
                    self.override.unlink()
                else:
                    write_private(self.override, old_override)
                print(f'启动失败，已恢复原覆盖配置，备份位于 {backup}。', file=sys.stderr)
                print('容器可能已部分更新；请检查 docker compose logs --tail=80，修复后重试。数据库迁移不会自动回滚。', file=sys.stderr)
                fail('部署未完成。')
            print(f'部署完成。选择已保存到 {self.override}；配置备份位于 {backup}。')
            run(self.command(self.override) + ['ps', self.service])

    def menu(self):
        managed = copy.deepcopy(self.managed)
        service = managed['services'][self.service]
        image_ref = self.current['services'][self.service]['image']
        repo, sep, tag = image_ref.rpartition(':')
        if not sep or '/' in tag:
            repo, tag = image_ref, 'latest'
        # First switch defaults to the maintained image, not the old official image.
        image = os.environ.get('IMAGE') or (repo if self.override.exists() else DEFAULT_IMAGE)
        tag = os.environ.get('TAG') or (tag if self.override.exists() else 'main')
        print(f'\n部署目录：{self.directory}\n当前镜像：{image_ref}')
        print('当前沙盒：' + self.sandbox_environment().get('SANDBOX_PROVIDER', 'market'))
        if interactive:
            print('\n1) 更新当前选择的镜像\n2) 切换到 main\n3) 切换到 canary'
                  '\n4) 自定义镜像和标签\n5) 切换沙盒（Onlyboxes / Market）'
                  '\n6) 检查当前 Onlyboxes\n7) 启动或恢复完整部署\n0) 退出')
            choice = ask('请选择', '1')
        else:
            choice = '1'
        if choice == '0':
            return
        if choice == '6':
            self.check_onlyboxes()
            return
        if choice == '2':
            tag = 'main'
        elif choice == '3':
            tag = 'canary'
        elif choice == '4':
            image = ask('镜像仓库', image)
            tag = ask('镜像标签', tag)
        elif choice == '5':
            self.select_sandbox(managed)
        elif choice not in ('1', '7'):
            fail('无效选项。')
        # Sandbox-only changes preserve even an untagged or digest-pinned image.
        service['image'] = image_ref if choice == '5' else validate_image(image, tag)
        self.deploy(managed, fresh=choice == '7')


def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'lobehub-deploy-manager'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode('utf-8')


def new_install(directory):
    if not interactive:
        fail('首次安装需要交互式运行，以配置访问地址和生成独立密钥。')
    directory.mkdir(parents=True, exist_ok=True)
    # Never replace a partial or existing deployment's .env/data.
    allowed = {'deploy-custom-image.sh'}
    if any(path.name not in allowed for path in directory.iterdir()):
        fail('首次安装目录必须为空（可包含部署脚本）；请选择新目录，避免覆盖已有数据。')
    print(f'\n首次安装到 {directory}')
    image = ask('镜像仓库', os.environ.get('IMAGE', DEFAULT_IMAGE))
    choice = ask('分支：1) main  2) canary  3) 自定义标签', '1')
    if choice not in ('1', '2', '3'):
        fail('无效选项。')
    tag = {'1': 'main', '2': 'canary'}.get(choice) or ask('镜像标签')
    image_ref = validate_image(image, tag)
    template_ref = tag if tag in ('main', 'canary') else ask('Compose 模板分支', 'main')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', template_ref):
        fail('模板分支格式无效。')
    app_url = ask('浏览器访问 LobeHub 的完整地址，例如 http://10.10.10.118:3210')
    parsed = validate_url(app_url)
    if parsed.path not in ('', '/'):
        fail('APP_URL 不支持子路径，请使用域名或 IP 加端口。')
    port = ask('本机 LobeHub 端口', str(parsed.port or 3210))
    host = '[' + parsed.hostname + ']' if ':' in parsed.hostname else parsed.hostname
    gateway_url = ask('浏览器访问 Agent Gateway 的完整地址', f'{parsed.scheme}://{host}:8787')
    device_url = ask('CLI 访问 Device Gateway 的完整地址', f'{parsed.scheme}://{host}:8788')
    s3_url = ask('浏览器访问对象存储的完整地址', f'{parsed.scheme}://{host}:9000')
    for url in (gateway_url, device_url, s3_url):
        validate_url(url)
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        fail('端口需要在 1 到 65535 之间。')
    ports = [int(port), 8787, 8788, 9000, 9001, 5432, 6379]
    if len(set(ports)) != len(ports):
        fail('LobeHub 端口与依赖服务端口冲突。')
    for number in ports:
        with socket.socket() as sock:
            try:
                sock.bind(('0.0.0.0', number))
            except OSError:
                fail(f'端口 {number} 已占用，请处理后再安装。')
    print('将安装 LobeHub、Gateway、PostgreSQL、Redis、RustFS 和 SearXNG。')
    print('配置备份不包含数据库；Onlyboxes 需要单独部署 Console 和 worker。')
    if not confirm('确认下载配套文件并生成全新部署配置'):
        print('已取消。')
        return
    run(['docker', 'pull', image_ref])
    keys = json.loads(run(['docker', 'run', '--rm', '--entrypoint', '/bin/node',
                         image_ref, '-e', JWKS_SCRIPT], capture=True).stdout)
    # Fetch every file before writing any deployment configuration.
    root = f'https://raw.githubusercontent.com/lichao0223/lobehub/{template_ref}/docker-compose/deploy/'
    names = ('docker-compose.yml', '.env.example', 'searxng-settings.yml',
             'bucket.config.json', 'elasticsearch/Dockerfile')
    files = {name: download(root + name) for name in names}
    values = {
        'LOBE_PORT': port, 'APP_URL': app_url.rstrip('/'),
        'KEY_VAULTS_SECRET': base64.b64encode(secrets.token_bytes(32)).decode(),
        'AUTH_SECRET': secrets.token_urlsafe(32), 'GATEWAY_SERVICE_TOKEN': secrets.token_hex(32),
        'JWKS_KEY': json.dumps(keys['private'], separators=(',', ':')),
        'JWKS_PUBLIC_KEY': json.dumps(keys['public'], separators=(',', ':')),
        'POSTGRES_PASSWORD': secrets.token_hex(24), 'RUSTFS_SECRET_KEY': secrets.token_hex(24),
        'S3_ENDPOINT': s3_url, 'AGENT_GATEWAY_URL': gateway_url,
        'DEVICE_GATEWAY_PUBLIC_URL': device_url,
    }
    env = files.pop('.env.example')
    for key, value in values.items():
        line = key + "='" + str(value).replace("'", "\\'") + "'"
        if re.search(r'^' + key + '=', env, re.M):
            env = re.sub(r'^' + key + '=.*$', lambda _: line, env, flags=re.M)
        else:
            env += '\n' + line + '\n'
    for name, content in files.items():
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        write_private(target, content)
        target.chmod(0o644)
    source_script = os.environ.get('LOBEHUB_MANAGER_SCRIPT_PATH')
    if source_script and Path(source_script).resolve() != directory / 'deploy-custom-image.sh':
        write_private(directory / 'deploy-custom-image.sh', Path(source_script).read_text())
    write_private(directory / '.env', env)
    manager = Manager(directory, directory / 'docker-compose.yml')
    managed = copy.deepcopy(manager.managed)
    managed['services'][manager.service]['image'] = image_ref
    manager.select_sandbox(managed)
    manager.deploy(managed, fresh=True)
    print(f'配置已生成。浏览器地址：{app_url}')
    print(f'以后更新：进入 {directory}，运行 bash deploy-custom-image.sh。')
    if parsed.scheme == 'https':
        print('HTTPS 地址需要配置对应反向代理、证书和 WebSocket 转发。')


def main():
    global interactive
    parser = argparse.ArgumentParser(description='LobeHub 新机安装、镜像更新与 Onlyboxes 沙盒切换')
    parser.add_argument('--non-interactive', action='store_true', help='按 IMAGE/TAG 更新已有部署')
    parser.add_argument('--install', action='store_true', help='首次安装到新目录')
    args = parser.parse_args()
    interactive = not args.non_interactive and os.path.exists('/dev/tty')
    if interactive:
        try:
            with open('/dev/tty'):
                pass
        except OSError:
            interactive = False
    check_docker()
    compose_env = os.environ.get('COMPOSE_FILE')
    directory_env = os.environ.get('DEPLOY_DIR')
    if compose_env:
        if ':' in compose_env:
            fail('COMPOSE_FILE 只支持一个 Compose 文件。')
        compose = Path(compose_env).resolve()
        if not compose.is_file():
            fail(f'找不到 Compose 文件：{compose}')
        directory = Path(directory_env).resolve() if directory_env else compose.parent
        if directory != compose.parent:
            fail('DEPLOY_DIR 必须是 Compose 文件所在目录。')
    else:
        candidates = [Path(directory_env)] if directory_env else [Path.cwd(), Path(os.environ['LOBEHUB_MANAGER_SCRIPT_DIR'])]
        compose = next((find_compose(path) for path in candidates if find_compose(path)), None)
        directory = compose.parent if compose else Path(directory_env or '/opt/lobehub')
    if args.install or compose is None:
        if compose is not None:
            fail('该目录已有部署，直接运行脚本即可更新；不会重新生成密钥。')
        directory = Path(ask('未发现已有部署，首次安装目录', str(directory))).expanduser().resolve()
        new_install(directory)
    else:
        Manager(directory, compose).menu()


if __name__ == '__main__':
    interactive = False
    try:
        main()
    except (RuntimeError, ValueError, OSError, urllib.error.URLError, KeyboardInterrupt) as error:
        print('错误：' + str(error), file=sys.stderr)
        sys.exit(1)
PY
