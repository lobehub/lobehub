# Security Policy

## Supported Versions

We only provide security fixes for the **latest 2.x release**. Older versions (including all 1.x releases) are end-of-life and will not receive patches.

| Version      | Supported |
| ------------ | --------- |
| 2.x (latest) | ✅        |
| 1.x          | ❌        |
| 0.x          | ❌        |

If you are running a 1.x deployment, we strongly recommend upgrading to the latest 2.x release.

## Reporting a Vulnerability

Please report security vulnerabilities through the GitHub Security Advisory ["Report a Vulnerability"](https://github.com/lobehub/lobehub/security/advisories/new) tab.

**Please do not report security vulnerabilities through public GitHub issues.**

### Response Timeline

- **Acknowledgement**: We aim to respond to all reports within **7 days**.
- **Fix**: Confirmed vulnerabilities will be addressed within **30 days**.
- **Urgent issues**: If you believe the vulnerability is critical and actively exploitable, you can reach out directly on Discord (`arvinxu`) for faster coordination.

### What to Include

A good vulnerability report should include:

- A clear description of the issue and its potential impact
- The affected version (must be the latest 2.x release)
- Step-by-step reproduction instructions or a working PoC
- Any relevant logs, screenshots, or code references

## Scope

### In Scope

- Security issues affecting the **latest 2.x release** of LobeHub
- Vulnerabilities in the **server-side deployment** (LobeHub Cloud or self-hosted server mode)
- Issues that can be exploited **without requiring admin/owner access** to the deployment

### Out of Scope (Not a Vulnerability)

The following are considered **by design** or **out of scope** and will not be accepted as vulnerability reports:

#### 1. End-of-Life Versions

Any issue that only affects 1.x or earlier versions. This includes but is not limited to the `X-lobe-chat-auth` header mechanism, `webapi` route authentication, and other 1.x-specific architectures that have been completely removed in 2.x.

#### 2. File Proxy Public Access (`/f/:id`)

The file proxy endpoint `/f/:id` uses randomly generated, non-enumerable IDs as [capability URLs](https://www.w3.org/TR/capability-urls/). This is a deliberate design choice, similar to how S3 presigned URLs or Google Docs sharing links work. Knowing the URL grants access — this is by design, not an authorization bypass.

#### 3. User Enumeration on Login Flows

Endpoints such as `check-user` that indicate whether an account exists are part of the standard login UX. This is a common and intentional pattern used by most modern authentication flows.

#### 4. Self-Hosted Client-Side API Key Storage

In self-hosted client-side mode, users configure their own API keys which are stored in the browser's local storage. This is the expected behavior for client-side deployments where the user is both the operator and the consumer.

#### 5. Issues Requiring Admin or Owner Privileges

Actions that require administrative access to the deployment (e.g., environment variable configuration, server-side settings) are not considered security vulnerabilities, as the admin is already a trusted party.

#### 6. Theoretical Attacks Without Practical Impact

Reports based on theoretical attack scenarios without a working proof of concept against a realistic deployment, or issues that require unlikely preconditions (e.g., physical access to the server, pre-existing compromise of the host system).

## Disclosure Policy

- We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure).
- We will credit reporters in the security advisory unless they prefer to remain anonymous.
- Please allow us reasonable time to address the issue before any public disclosure.

## Contact

- **Primary**: [GitHub Security Advisories](https://github.com/lobehub/lobehub/security/advisories/new)
- **Urgent**: Discord — `arvinxu`
