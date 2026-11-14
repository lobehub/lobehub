# LobeHub 部署管理脚本

单文件入口：`deploy-custom-image.sh`。在终端运行，按菜单选择首次安装、镜像更新或沙盒切换。

## 下载与运行

新机器（Ubuntu/Debian 可以按提示安装 Docker Engine、Compose 和 Python 3）：

```bash
curl -fL https://raw.githubusercontent.com/lichao0223/lobehub/canary/scripts/deploy-custom-image.sh -o deploy-custom-image.sh
sudo bash deploy-custom-image.sh
```

已有部署（在原 Compose 目录运行，不会重新生成数据库密码及认证密钥）：

```bash
cd /root/lobehub
curl -fL https://raw.githubusercontent.com/lichao0223/lobehub/canary/scripts/deploy-custom-image.sh -o deploy-custom-image.sh
bash deploy-custom-image.sh
```

菜单选项：更新当前镜像、切换 main、切换 canary、自定义镜像、切换 Onlyboxes/Market、检查 Onlyboxes、启动或恢复完整部署。
main/canary 对应镜像标签，必须先由本 Fork 的 `Publish custom Docker image` 工作流发布。

脚本自动识别当前目录或脚本目录中的 Compose 文件；否则询问首次安装目录（默认 `/opt/lobehub`）。
可使用 `DEPLOY_DIR`、`COMPOSE_FILE`、`SERVICE`、`IMAGE`、`TAG` 指定配置。

```bash
DEPLOY_DIR=/root/lobehub TAG=canary bash deploy-custom-image.sh --non-interactive
```

非交互模式只更新已有部署；首次安装需要终端输入地址。

## 首次安装

脚本检查 Docker daemon、Compose、目标目录和端口，拉取所选镜像，并下载同分支的 Compose、SearXNG、桶策略及可选 Elasticsearch 构建文件。
创建独立的数据库密码、S3 密钥、认证密钥、Gateway token 和 RSA JWKS，再启动完整栈。
默认依赖服务端口为 5432、6379、8787、8788、9000、9001；应用端口可选。
浏览器、Gateway 和 S3 地址必须可由客户端访问；HTTPS 需要自行配置证书、反向代理及 WebSocket 转发。
通过普通局域网 HTTP 访问时，浏览器安全上下文 API 可能不可用，正式使用建议配置 HTTPS。

安装目录必须为空（允许包含脚本本身）。已有 `.env` 或数据的目录禁止重新安装。
若首次启动失败，保留配置用于排查；修复后重新运行脚本，选择“启动或恢复完整部署”。

## Onlyboxes

本脚本**接入已有的 Onlyboxes，不安装 Onlyboxes Console/worker**。LobeHub 仓库不包含它们的部署清单。
Onlyboxes 可以部署在同机或其他内网机器；不以本机是否存在同名容器判断是否可用。

从菜单选择切换到 Onlyboxes，然后填写：

- Console 基础 URL（不含 `/api/v1`，不能使用指向 LobeHub 容器自身的 localhost）。
- 与 Console `CONSOLE_JIT_SIGNING_KEY` 一致的签名密钥（隐藏输入）。
- JIT issuer（默认沿用当前配置或 APP_URL）。

切换前在一次性 LobeHub 容器内，使用相同 Compose 网络和配置，签发 JIT token 并执行真实 terminal 命令。
因此会检查容器网络、API、认证和 `terminalExec` worker；创建的检查会话请求 60 秒租期。
检查失败不写入覆盖配置，不重启已有应用。Onlyboxes 的文件导出还要求 worker 提供 `terminalResource`，此探测不验证文件导出。
选择 Market 会清空托管的 Onlyboxes 配置，但 Market 本身是否可用仍取决于 Market 配置和授权。

## 持久化、备份和故障恢复

选择保存在标准 Compose override 文件，普通 `docker compose up -d` 也能沿用。
已有非本脚本管理的 override 文件会阻止操作，避免覆盖用户配置。
托管文件、临时文件及配置备份权限为 600；备份目录为 700。密钥不会作为命令行参数或检查输出显示。
拉取失败不会更改配置；启动失败恢复原 override 文件，但容器可能已部分更新，需要人工检查。

每次部署备份 Compose、`.env` 和原 override。**配置备份不是数据库备份，数据库迁移不能靠切换镜像自动撤销。**
日常更新只重建应用服务；“启动或恢复完整部署”会启动依赖服务。

## Fork 的 Actions

上游专用 Branch Synchronization、Deploy Workbench、Release Desktop Canary、Release ModelBank 和 Preview CLI 默认在 Fork 中跳过。
只有官方仓库，或显式设置仓库变量 `ENABLE_UPSTREAM_PUBLISH_WORKFLOWS=true` 的仓库，才执行这些任务。
启用前需配置各自 GitHub App、Cloudflare/S3、桌面 OTA 和 npm 发布凭据。
代码测试及本 Fork 的镜像发布不受此开关影响。

## 验证

```bash
bash -n scripts/deploy-custom-image.sh
python3 scripts/deploy-custom-image.test.py
python3 scripts/deploy-custom-image.test.py --compose-check
```

前两项不依赖 Docker daemon；Onlyboxes 协议测试需要 Node.js（缺失时跳过）。最后一项需要 Docker Compose 插件，使用真实 Compose 解析验证新机配置和密钥插值，不启动容器。
完整安装和实际 Onlyboxes 接入需要在目标服务器运行；自动化测试不能替代它们。
