# Pi Claude DirectSDK

[![npm version](https://img.shields.io/npm/v/pi-claude-directsdk.svg)](https://www.npmjs.com/package/pi-claude-directsdk)

Use Claude inside Pi through the unmodified Claude Code executable. Pi owns the transcript, tools, approvals, and retries. The CLI supplies subscription authentication as a model transport.

Capabilities:

- Run `sonnet`, `opus`, `haiku`, and versioned routes as Pi models, including `claude-haiku-5-5`.
- Execute Pi tools (`read`, `bash`, `edit`, `write`, `codemode`) with Claude models.
- Resume sessions with exact replay of native signed thinking.
- Switch providers mid-session; foreign thinking replays as ordinary assistant text.
- Refresh model routes, limits, and prices from Claude Code and Anthropic documentation.
- Work in interactive, print (`-p`), and resumed sessions.

Limits:

- One Pi model call spawns one request-scoped `claude` process.
- One Pi model call produces at most one upstream Messages request.
- The provider never manages login, never reads credentials, and never falls back to another billing route.
- Required strict constrained decoding (`strict: "require"`) is rejected. See [docs/architecture.md](docs/architecture.md#tool-transport).

## Requirements

- Node 20 or later.
- Claude Code in the qualified range `>=2.1.263 <2.2.0` (see `QUALIFIED_CLI_RANGE` in `src/models.ts`).
- A Claude paid plan. The free plan excludes the CLI.
- A Claude Code login via `claude auth login`.

The installed-Pi harness is verified with Pi 1.1.0 and Claude Code 2.1.281. Verification includes offline startup and a paid request from a complete existing-session fork.

## Install

Install the qualified Claude Code version:

```sh
npm install -g --ignore-scripts=false @anthropic-ai/claude-code@2.1.281
```

Sign in through the official CLI login:

```sh
claude auth login
```

Install the extension, then restart Pi:

```sh
pi install git:github.com/joaomj/pi-claude-directsdk
```

Refresh model catalogs once before selecting a DirectSDK model on a fresh install:

```sh
pi update --models
```

Then start Pi with a DirectSDK model:

```sh
pi --model claude-directsdk/haiku
```

DirectSDK uses the CLI login, not the Pi Anthropic login. The `npm install` flag enables the Claude Code installer for that command only.

The model catalog does not guarantee account entitlement. Start with `haiku` for a small request. Models that require usage credits can incur separate charges. To use only the included subscription allowance, disable additional paid usage in your Claude account.

## Use

Start Pi with the local extension without installing it:

```sh
pi -e ./extensions/claude-directsdk/index.ts
```

Open `/model` and wait for catalog refresh. Then select a DirectSDK model. Later invocations can use the verified snapshot:

```sh
pi -e ./extensions/claude-directsdk/index.ts --list-models claude-directsdk
pi -e ./extensions/claude-directsdk/index.ts -p --model claude-directsdk/sonnet -- "Hello."
```

Startup performs no CLI probes or web requests. Pi restores only a previously verified catalog snapshot, labeled as such. A fresh offline install has no DirectSDK models. Interactive Pi refreshes catalogs in the background after the editor is ready.

Refresh uses Claude Code's account picker and Anthropic's public model, pricing, and effort documentation. Models absent from the account picker are labeled `not in CLI picker`; their account entitlement is unverified. Missing required metadata excludes the affected model with a warning. A failed refresh reports the error and removes the snapshot. There is no pinned fallback.

The request transport still loads on the first Claude request. See [docs/startup.md](docs/startup.md) for behavior and limits.

## Configuration

| Setting | Purpose |
|---|---|
| `CLAUDE_DIRECTSDK_COMMAND` | Override the `claude` executable path. |
| `CLAUDE_DIRECTSDK_CONFIG_DIR` | Point at a logged-in CLI config directory. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Supply a token from `claude setup-token` in the environment Pi runs in. |
| `PI_DIRECTSDK_PROMPT_HASHES` | Set to `1` to add SHA-256 hashes of the provider-supplied system prompt and tool definitions to message diagnostics. Unset it or set it to `0` to disable hashes. |

Success and failure diagnostics include request-phase timings, replay counts, upstream request-body bytes, and cache-read share. Unobserved milestones and unavailable cache-read shares are `null`. Milestone times are elapsed milliseconds from call start; durations are separate intervals and are not additive. The spawn-to-replay interval includes CLI startup, and first response data is not necessarily the first generated token.

Cache-read share measures token reuse, not subscription allowance deductions. Prefix hashes cover the Pi-supplied system prompt and tool definitions; they do not detect system-prompt changes added by Claude Code. Diagnostics store hashes, not the prompt or tool definitions.

See [docs/troubleshooting.md](docs/troubleshooting.md) for login and environment errors.

## Verify

```sh
npm test
```

This runs offline startup verification through your installed Pi and consumes no subscription allowance. Real model requests and complete-session replay require explicit approval. See [docs/testing.md](docs/testing.md).

## Costs

Per-model cost metadata comes from [Anthropic’s pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing). Pi reports it as an estimate, never as a subscription charge. Failed or interrupted requests are never reported as free.

## Comparison with pi-claude-bridge

[pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) is the closest alternative: both expose Claude as a Pi provider and let Pi execute provider tools. DirectSDK prioritizes request isolation and Pi-owned state. Bridge uses the official Agent SDK and adds optional delegation to Claude agents.

This comparison covers DirectSDK 0.1.6 and [Bridge source at `b2e7255`](https://github.com/elidickinson/pi-claude-bridge/tree/b2e7255ece0b8bfd3a6429fd5c147fd59984c785), reviewed on October 13, 2026. It is a source and documentation comparison, not a head-to-head benchmark.

| Dimension | DirectSDK | pi-claude-bridge |
|---|---|---|
| Transport and agent loop | Unmodified Claude CLI behind a local admission relay. Each Pi model call admits at most one upstream Messages request. | Official Agent SDK `query()`. An active query continues across Pi tool boundaries. |
| Tool execution | Inert MCP advertises tools but never executes them. Pi receives executable calls only after the upstream response completes and the child exits. Native tools are disabled. | MCP handlers wait for Pi to execute tools and return results to the active query. Native tools are disabled in provider mode. |
| System prompt | Supplies Pi's current system prompt through `--system-prompt-file` on every call. Claude Code can still add native context. | Uses the Claude Code prompt preset with selected Pi context, skills, and instructions appended. Some injection routes are unsupported, and resumed sessions can retain earlier instructions. |
| Conversation state | Reconstructs each request from Pi's current transcript, including native signed thinking when its stored projection still matches. No Claude session mirror. | Resumes a Claude session that mirrors Pi's history. Divergence, compaction, and some recovery paths require synchronization or rebuilding. |
| Process lifecycle | Fresh Claude process and serialized history replay for every Pi model call, including calls after tool execution. | Keeps the SDK query active across tool boundaries. Later user turns start a new query that can resume the saved session. |
| Prompt caching | Explicit historical cache anchor, matching cache lifetimes, stable empty native working directory, and reuse diagnostics. | Uses Claude Code caching and session resume, and suppresses changing Git instructions to stabilize the prefix. Its README reports cache misses after session rebuilds. |
| Connection reuse | Shared HTTP/HTTPS keep-alive agents, with at most two idle sockets per destination. Pools do not survive Pi restart. | Networking is handled by the SDK and Claude Code; the provider has no equivalent custom pooling layer. This does not establish that connections are not reused. |
| Authentication guards | Uses CLI login or a CLI setup token. Rejects conflicting API credentials, base URLs, and alternative backend settings rather than switching billing routes. | Uses Claude Code authentication through the SDK. Its README warns that inherited Anthropic API environment variables can redirect the child. |
| Startup and models | Cache-only startup and lazy transport loading. Refresh combines the CLI account picker with Anthropic documentation to validate model metadata. | Registers models from Pi's Anthropic catalog, with plan and context-window settings. |
| Compatibility and maintenance | Qualifies CLI versions `>=2.1.263 <2.2.0`; maintains replay, admission, SSE parsing, schema translation, and child supervision. | Uses a versioned Agent SDK dependency, with an optional external CLI. Maintains session synchronization, prompt projection, and MCP tool bridging. |
| Verification | Installed-Pi startup checks, documented paid replay and cache measurements, and lifecycle checks. No comprehensive isolated unit suite. | Provides offline unit tests and API-backed integration tests. Test availability alone does not prove greater reliability. |
| Additional features | Focused inference provider. | Optional `AskClaude` delegation, including read-only and full native-tool modes. |

### Cache evidence is not a speed comparison

The [transport measurements](docs/transport-measurements.md) report **99.59% and 99.71% cache-read share on two warm turns**, plus **99.84% after restarting Pi** in a separate Linux verification. These results show that reconstructing history can preserve prompt-cache reuse under stable inputs. They are repository-reported measurements, not independently reproduced results, and do not measure subscription allowance deductions.

The original 30-run baseline reported a **2,345.663 ms median provider completion**, including a **436.408 ms median child-spawn-to-replay interval**. It predates the cache repair and uses a different workload from the later cache checks. It does not demonstrate a post-fix speedup. No matched Bridge benchmark was established in this review, so there is no measured overall speed winner.

### Subscription and policy limits

Using the official CLI or SDK does not, by itself, establish Anthropic approval of either extension. Anthropic's [subscription guidance](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) states that Agent SDK, `claude -p`, and third-party app usage can still draw from subscription limits. Its [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview) separately says that third-party developers need prior approval to offer claude.ai login or rate limits in their products. These statements address different conditions; neither establishes project-specific approval or explicitly endorses DirectSDK's HTTP admission relay. Billing and policy guidance can change.

### Which to choose

Choose DirectSDK when you want Pi's current transcript and prompt to determine every request, with no mirrored Claude session and a hard one-request boundary. The trade-off is repeated child startup and history replay, plus custom transport maintenance.

Choose Bridge when you prefer the official SDK interface, query continuation across tool boundaries, or optional Claude-agent delegation. The trade-off is mirrored-session recovery and a Claude Code instruction environment rather than direct forwarding of Pi's full system prompt. See its [compatibility notes and known issues](https://github.com/elidickinson/pi-claude-bridge/blob/b2e7255ece0b8bfd3a6429fd5c147fd59984c785/README.md#compatibility-with-other-extensions) before relying on prompt injection or session rebuild behavior.

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | Request lifecycle, model routing, tool transport, admission relay. |
| [docs/startup.md](docs/startup.md) | Cache-only initialization and lazy loading. |
| [docs/testing.md](docs/testing.md) | Installed-Pi harness, paid scenarios, and complete-session replay. |
| [docs/transport-measurements.md](docs/transport-measurements.md) | Timing baseline, verified warm-cache reuse, and measurement limits. |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Missing CLI, logged-out CLI, conflicting environment. |

## Acknowledgments

Behavioral reference: [Hermes Claude Subscription DirectSDK](https://github.com/NousResearch/hermes-plugin-claude-subscription-directsdk) (MIT). This project copies its behavior contract, not its code.

## License

MIT. See `LICENSE`.
