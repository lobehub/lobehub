# Team Assignment Guide

## Quick Reference by Name

- **@arvinxx**: Last resort only, mention for priority:high issues, tool calling , mcp
- **@canisminor1990**: Design, UI components, editor, markdown rendering
- **@tjx666**: Image/video generation, vision, cloud version, documentation, TTS, auth, login/register
- **@ONLY-yours**: Performance, streaming, settings, general bugs, web platform, marketplace
- **@RiverTwilight**: Knowledge base, files (KB-related), group chat
- **@nekomeowww**: Memory, backend, deployment, DevOps
- **@sudongyuer**: Mobile app (React Native)
- **@sxjeru**: Model providers and configuration
- **@rdmclin2**: Team workspace
- **@tcmonster**: Subscription, refund, recharge, business cooperation

Quick reference for assigning issues based on labels.

## Label to Team Member Mapping

### Provider Labels (provider:\*)

| Label            | Owner   | Notes                                        |
| ---------------- | ------- | -------------------------------------------- |
| All `provider:*` | @sxjeru | Model configuration and provider integration |

### Platform Labels (platform:\*)

| Label              | Owner       | Notes                                  |
| ------------------ | ----------- | -------------------------------------- |
| `platform:mobile`  | @sudongyuer | React Native mobile app                |
| `platform:desktop` | @ONLY-yours | Electron desktop client (general)      |
| `platform:web`     | @ONLY-yours | Web platform (unless specific feature) |

### Feature Labels (feature:\*)

| Label                    | Owner           | Notes                                                                   |
| ------------------------ | --------------- | ----------------------------------------------------------------------- |
| `feature:image`          | @tjx666         | AI image generation                                                     |
| `feature:dalle`          | @tjx666         | DALL-E related                                                          |
| `feature:vision`         | @tjx666         | Vision/multimodal generation                                            |
| `feature:knowledge-base` | @RiverTwilight  | Knowledge base and RAG                                                  |
| `feature:files`          | @RiverTwilight  | File upload/management (when KB-related)<br>@ONLY-yours (general files) |
| `feature:editor`         | @canisminor1990 | Lobe Editor                                                             |
| `feature:markdown`       | @canisminor1990 | Markdown rendering                                                      |
| `feature:auth`           | @tjx666         | Authentication/authorization                                            |
| `feature:login`          | @tjx666         | Login issues                                                            |
| `feature:register`       | @tjx666         | Registration issues                                                     |
| `feature:api`            | @nekomeowww     | Backend API                                                             |
| `feature:streaming`      | @arvinxx        | Streaming response                                                      |
| `feature:settings`       | @ONLY-yours     | Settings and configuration                                              |
| `feature:agent`          | @ONLY-yours     | Agent/Assistant                                                         |
| `feature:topic`          | @ONLY-yours     | Topic/Conversation management                                           |
| `feature:thread`         | @arvinxx        | Thread/Subtopic                                                         |
| `feature:marketplace`    | @ONLY-yours     | Agent marketplace                                                       |
| `feature:tool`           | @arvinxx        | Tool calling                                                            |
| `feature:mcp`            | @arvinxx        | MCP integration                                                         |
| `feature:search`         | @ONLY-yours     | Search functionality                                                    |
| `feature:tts`            | @tjx666         | Text-to-speech                                                          |
| `feature:export`         | @ONLY-yours     | Export functionality                                                    |
| `feature:group-chat`     | @RiverTwilight  | Group chat functionality                                                |
| `feature:memory`         | @nekomeowww     | Memory feature                                                          |
| `feature:team-workspace` | @rdmclin2       | Team workspace application                                              |
| `feature:subscription`   | @tcmonster      | Subscription and billing                                                |
| `feature:refund`         | @tcmonster      | Refund requests                                                         |
| `feature:recharge`       | @tcmonster      | Recharge and payment                                                    |
| `feature:business`       | @tcmonster      | Business cooperation and partnership                                    |

### Deployment Labels (deployment:\*)

| Label              | Owner       | Notes                      |
| ------------------ | ----------- | -------------------------- |
| All `deployment:*` | @nekomeowww | Server/client/pglite modes |

### Hosting Labels (hosting:\*)

| Label               | Owner       | Notes                  |
| ------------------- | ----------- | ---------------------- |
| `hosting:cloud`     | @tjx666     | Official LobeHub Cloud |
| `hosting:self-host` | @nekomeowww | Self-hosting issues    |
| `hosting:vercel`    | @nekomeowww | Vercel deployment      |
| `hosting:zeabur`    | @nekomeowww | Zeabur deployment      |
| `hosting:railway`   | @nekomeowww | Railway deployment     |

### Issue Type Labels

| Label              | Owner                     | Notes                        |
| ------------------ | ------------------------- | ---------------------------- |
| 💄 Design          | @canisminor1990           | Design and styling           |
| 📝 Documentation   | @canisminor1990 / @tjx666 | Official docs website issues |
| ⚡️ Performance     | @ONLY-yours               | Performance optimization     |
| 🐛 Bug             | (depends on feature)      | Assign based on other labels |
| 🌠 Feature Request | (depends on feature)      | Assign based on other labels |

## Assignment Rules

### Priority Order (apply in order)

1. **Specific feature owner** - e.g., `feature:knowledge-base` → @RiverTwilight
2. **Platform owner** - e.g., `platform:mobile` → @sudongyuer
3. **Provider owner** - e.g., `provider:*` → @sxjeru
4. **Component owner** - e.g., 💄 Design → @canisminor1990
5. **Infrastructure owner** - e.g., `deployment:*` → @nekomeowww
6. **General maintainer** - @ONLY-yours for general bugs/issues
7. **Last resort** - @arvinxx (only if no clear owner)

### Special Cases

**Multiple labels with different owners:**

- Mention the **most specific** feature owner first
- Mention secondary owners if their input is valuable
- Example: `feature:knowledge-base` + `deployment:server` → @RiverTwilight (primary), @nekomeowww (secondary)

**Priority:high issues:**

- Mention feature owner + @arvinxx
- Example: `priority:high` + `feature:image` → @tjx666 @arvinxx

**No clear owner:**

- Assign to @ONLY-yours for general issues
- Only mention @arvinxx if critical and truly unclear

## Comment Templates

**Single owner:**

```
@username - This is a [feature/component] issue. Please take a look.
```

**Multiple owners:**

```
@primary @secondary - This involves [features]. Please coordinate.
```

**High priority:**

```
@owner @arvinxx - High priority [feature] issue.
```
