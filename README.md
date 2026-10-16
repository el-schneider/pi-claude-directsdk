# Pi Claude DirectSDK

[![npm version](https://img.shields.io/npm/v/pi-claude-directsdk.svg)](https://www.npmjs.com/package/pi-claude-directsdk)

Use Claude inside Pi through the unmodified Claude Code executable. Pi owns the transcript, tools, approvals, and retries. The CLI supplies subscription authentication as a model transport.

## Requirements

- Pi. The current maintainer installation is Pi 1.3.0; see [verification details](docs/testing.md#verified-environments).
- Node 20 or later for Node-based Pi installations and local development. Compiled Pi uses its bundled runtime.
- Claude Code in the qualified range `>=2.1.263 <2.2.0` (see `QUALIFIED_CLI_RANGE` in `src/models.ts`).
- A Claude paid plan. The free plan excludes the CLI.
- A Claude Code login via `claude auth login`.

## Install

Install the qualified Claude Code version:

```sh
npm install -g --ignore-scripts=false @anthropic-ai/claude-code@2.1.281
```

Sign in through the official CLI login:

```sh
claude auth login
```

Install the extension from npm:

```sh
pi install npm:pi-claude-directsdk
```

Alternatively, install from Git. Choose one source, not both:

```sh
pi install git:github.com/joaomj/pi-claude-directsdk
```

Start or restart interactive Pi, open `/model`, and wait for the DirectSDK catalog refresh. Select a DirectSDK model. On a fresh install, this step must complete before selecting the model from the command line.

`pi update --models` does not load this extension in Pi 1.3.0; use the interactive model picker for DirectSDK refresh. After a successful refresh, later invocations can use the saved catalog:

```sh
pi --model claude-directsdk/haiku
```

DirectSDK uses the CLI login, not the Pi Anthropic login. The `npm install` flag enables the Claude Code installer for that command only.

The model catalog does not guarantee account entitlement. Start with `haiku` for a small request. Models that require usage credits can incur separate charges. To use only the included subscription allowance, disable additional paid usage in your Claude account.

## Upgrade

Update the source you installed:

```sh
# npm installation
pi update npm:pi-claude-directsdk

# Git installation
pi update git:github.com/joaomj/pi-claude-directsdk
```

Run only the command for your source; `pi list` shows installed declarations. Version-pinned sources remain pinned when updated. To change a pin or switch sources, remove the old declaration with `pi remove <old-source>`, then install the desired source. Do not keep both npm and Git installations.

Restart Pi after upgrading, then open `/model` and wait for catalog refresh.

## Cache improvements

Since v0.1.7, an explicit historical cache anchor lets stable conversation history reuse the upstream prompt cache. A stable native working directory also preserves the native prefix across Pi restarts.

Measured cache-read shares were **99.59% and 99.71% on two warm turns**, and **99.84% after restarting Pi** in a separate Linux verification. Every call still sends Pi's conversation history and starts a fresh Claude process.

These repository-reported results depend on stable inputs, cache lifetime, and upstream availability. They measure token reuse, not subscription allowance deductions, guaranteed savings, or a speed advantage over Bridge. See the [measurement report](docs/transport-measurements.md) for workloads and limits.

Pi's per-model costs are estimates from [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), not subscription charges. Failed or interrupted requests are never reported as free.

## Comparison with pi-claude-bridge

[pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) also exposes Claude as a Pi provider and lets Pi execute tools.

- **DirectSDK:** Pi's current transcript and prompt determine each request. A fresh CLI process admits at most one upstream Messages request, with no mirrored Claude session. The trade-off is repeated process startup and history replay, plus custom transport maintenance.
- **Bridge:** Uses the official Agent SDK, continues queries across Pi tool boundaries, and offers optional Claude-agent delegation. The trade-off is mirrored-session recovery and a Claude Code instruction environment rather than direct forwarding of Pi's full system prompt.

There is no matched benchmark establishing an overall speed winner. Using the official CLI or SDK does not establish Anthropic approval of either extension. See the [full comparison](docs/comparison.md) for source versions, evidence, compatibility details, and subscription policy limits.

## Documentation

- [Usage and configuration](docs/usage.md): local checkout, environment settings, diagnostics, and verification.
- [Architecture](docs/architecture.md): request lifecycle diagram, model routing, tool transport, and admission relay.
- [Startup](docs/startup.md): catalog refresh, cache-only initialization, and lazy loading.
- [Troubleshooting](docs/troubleshooting.md): missing CLI, login, and conflicting environment settings.
- [Testing](docs/testing.md): verified environments, offline checks, and paid replay scenarios. Offline startup was verified on Pi 1.3.0; paid conversation checks used Pi 1.2.0 and have not been repeated on 1.3.0.
- [Transport measurements](docs/transport-measurements.md): timing baseline, warm-cache reuse, and measurement limits.
- [Full Bridge comparison](docs/comparison.md): transport, state, caching, authentication, and policy trade-offs.

## Issues and security

Bug reports, feature requests, and questions are welcome through [issue forms](https://github.com/joaomj/pi-claude-directsdk/issues/new/choose).
This project does not accept unsolicited public pull requests. See [contribution guidance](CONTRIBUTING.md).
Report vulnerabilities privately as described in the [security policy](SECURITY.md).

## Acknowledgments

Behavioral reference: [Hermes Claude Subscription DirectSDK](https://github.com/NousResearch/hermes-plugin-claude-subscription-directsdk) (MIT). This project copies its behavior contract, not its code.

## License

MIT. See `LICENSE`.
