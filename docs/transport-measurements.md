# Long-session transport measurement baseline

The historical cache-anchor repair achieved **99.59% and 99.71% cache-read share on two warm turns** in a three-request same-process verification. Both warm turns also reused the upstream HTTPS connection.

This report records the original timing baseline, the cache investigation, and the post-fix verification. Workloads differ between batches, so their timings do not establish a transport speedup.

## Original 30-run timing result

The median provider-call completion time was **2,345.663 ms**. The nearest-rank p95 was **4,037.668 ms**. The upstream request-to-first-data interval had a median of **1,415.731 ms** and a p95 of **3,328.727 ms**.

| Measurement | Median | p95, nearest rank |
|---|---:|---:|
| Whole Pi process wall time | 3,704 ms | 5,631 ms |
| Provider call to completion | 2,345.663 ms | 4,037.668 ms |
| History preparation | 1.785 ms | 2.827 ms |
| Setup after history | 18.849 ms | 27.932 ms |
| Child spawn to replay complete | 436.408 ms | 704.098 ms |
| Replay complete to upstream request | 28.647 ms | 42.274 ms |
| Upstream request to first response data | 1,415.731 ms | 3,328.727 ms |
| First response data to upstream response end | 274.013 ms | 332.143 ms |
| Upstream request to response end | 1,743.929 ms | 3,478.182 ms |
| Upstream response end to child exit | 79.919 ms | 94.986 ms |
| Child exit to Pi completion | 0.427 ms | 0.711 ms |

The nearest-rank p95 for 30 samples is the 29th value, or the second-slowest sample. Treat it as an exploratory estimate from this one workload.

## Workload and method

- Model: `claude-directsdk/claude-haiku-5-5`.
- Runs: 30 sequential replays of the same saved session; all 30 succeeded.
- Session: 32 tool calls and 467,954 bytes on disk.
- Per replay: 69 prepared frames, including 68 historical frames and 34 historical user acknowledgments.
- Upstream request body: 347,888 bytes in every run.
- Percentiles: median and nearest-rank p95, calculated separately for each measurement.

The batch ran with opt-in prefix hashing enabled. The measured system-prompt hash differed in all 30 runs; the tool-definition hash was the same in all 30. This shows that the Pi-supplied prompt input was not byte-identical across runs. The hashes do not identify the cause or which prompt portion changed. This report does not include hashes, prompts, or tool arguments.

## Cache counters

The median cache-read share was **2.2028%**; its nearest-rank p95 was **2.2030%**. Across all runs, reported usage counters summed to 60 input tokens, 377 output tokens, 88,530 cache-read tokens, and 3,930,250 cache-write tokens.

These counters describe token usage and reuse. They do not state subscription allowance deductions or billed cost. Because the system-prompt hash changed between runs, do not treat this result as a fixed-prefix cache benchmark without first identifying the changing prompt input.

## Limits

This is one long-session scenario for one model. It is not a before-and-after comparison, and it does not show that a proposed transport change would improve latency.

The upstream request-to-first-data interval combines transport setup and upstream response delay. The measurement does not isolate DNS, connection establishment, response headers, or model processing. First response data is not necessarily the first generated token.

A separate single fresh-request check is not part of these N=30 statistics and is not a short-session cohort. This report also does not cover image-heavy requests, failed-call diagnostics, or end-to-end multi-turn task duration.


## Same-process cache investigation

Three additional paid requests ran sequentially through one Pi RPC process, using a private fork of an existing session and a fixed agent directory. All three succeeded, each admitted one upstream request, and the process produced no stderr. Auto-retry and auto-compaction were disabled. This measurement ran before connection pooling was implemented.

The starting session was 746,001 bytes, not the 467,954-byte session used in the earlier 30-run baseline. Do not compare their timings as a transport improvement.

| Turn | RPC prompt to settled | Provider completion | Cache-read tokens | Cache-write tokens | Cache-read share |
|---|---:|---:|---:|---:|---:|
| 1 | 3,620.861 ms | 3,510.288 ms | 2,951 | 196,674 | 1.4783% |
| 2 | 3,097.597 ms | 3,082.145 ms | 7,298 | 192,399 | 3.6545% |
| 3 | 2,365.867 ms | 2,350.713 ms | 7,298 | 192,460 | 3.6534% |

The Pi system prompt, native system blocks, and native tool definitions had identical content hashes across all three calls. Request bodies were 530,509, 530,844, and 531,134 bytes. Replay required 59, 60, and 61 historical user acknowledgments. History preparation took 0.930–2.542 ms, child spawn to replay completion took 531.599–602.012 ms, and replay completion to upstream request took 33.959–52.514 ms.

The earlier fresh-process benchmark changed paths that Pi includes in its system prompt. The same-process run removes that confound, but cache reuse remains low. Stable system and tool content alone does not explain the missing history reuse.

### Native prefix observations

A private observer recorded content hashes, byte counts, and cache-control positions at the native request boundary. It did not save prompt text, tool arguments, or authentication headers.

- Native requests contained 121, 123, and 125 messages.
- Two system text blocks had explicit one-hour cache controls.
- There were no tool breakpoints or top-level cache controls.
- Each request had one message breakpoint, on the first block of its final system-role message. That block had identical content across the three calls.
- For each consecutive pair, earlier history was identical. Differences began at the former final user message: its replay lost tail blocks, and the former final system-message position became an assistant message.

Thus, the conversation cache breakpoint was after native tail content that the next replay did not reproduce. There was no explicit conversation anchor in the unchanged historical prefix. The official [prompt-caching guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) requires exact matching prefixes and describes the distinction between cache-writing breakpoints and the limited backward lookup window. A stable earlier prefix does not, by itself, establish that the API cached that prefix.

These observations support adding an explicit anchor to stable historical replay content. Do not remove legitimate Pi instructions or freeze the system prompt to improve cache reuse.

### Cache-anchor repair

`src/replay.ts` now places one explicit cache control on the last nonempty block of the latest historical user/tool-result frame. It does not mark the final user frame: the CLI inserts transient reminder content inside that frame. The historical anchor lets the API write a reusable prefix before that transient content.

The change affects replay metadata only. It does not edit Pi messages, tool arguments, tool-result associations, system instructions, or signed thinking. If there is no historical user frame, it adds no anchor. The native completion gate and one-request admission limit remain unchanged.

Replay and native breakpoints use matching cache lifetimes. The transport defaults to `1h`, matching the original measured subscription requests. Set `CLAUDE_CODE_PROMPT_CACHE_TTL=5m` for a five-minute lifetime. `FORCE_PROMPT_CACHING_5M` takes precedence. Invalid TTL values produce an error that names the setting. Global and model-family cache-disable flags suppress the replay anchor.

The existing benchmark was run against a loopback-only, refused upstream to inspect real CLI request generation without paid requests. The CLI preserved the historical anchor before the final user and system-tail messages. Requests had four breakpoints: two system blocks, the historical anchor, and the native tail. Both one-hour and forced five-minute settings produced compatible cache controls.

Those model calls failed as expected because the upstream was blocked. That check verified native marker emission only. The subsequent paid verification below confirmed successful generation and high warm-cache reuse with one-hour controls. Longer gaps or more than the API's backward lookup window between anchors can still prevent reuse.

### Paid verification of the repair

Three approved requests ran sequentially through one Pi RPC process with the historical anchor and shared connection pools enabled. All three succeeded, each admitted one upstream request, and the process produced no stderr. Auto-retry and auto-compaction remained disabled.

| Turn | RPC prompt to settled | Provider completion | Cache-read tokens | Cache-write tokens | Cache-read share | HTTPS connection reused |
|---|---:|---:|---:|---:|---:|---|
| 1 | 3,312.022 ms | 3,192.764 ms | 2,951 | 111,010 | 2.59% | No |
| 2 | 3,154.486 ms | 3,139.958 ms | 113,576 | 464 | 99.59% | Yes |
| 3 | 1,731.962 ms | 1,714.062 ms | 113,772 | 332 | 99.71% | Yes |

The Pi system prompt, native system blocks, and native tool definitions had identical content hashes across these three calls. Native requests contained 93, 95, and 97 messages. Each had four one-hour breakpoints, including the historical anchor before the final user frame and native tail.

The first turn wrote the large prefix. The following turns read almost all input from cache and wrote only a small suffix. This confirms that the repaired request path can reuse historical content, rather than only system instructions and tool definitions.

The starting session file had grown to 1,520,559 bytes. Its replay prepared 91, 93, and 95 frames, compared with 119, 121, and 123 frames in the earlier cache investigation. Request bodies were 264,370, 264,730, and 265,028 bytes, not the earlier approximately 530 KB bodies. These are different replay workloads, not a controlled before-and-after latency comparison.

The earlier warm cache-read share was approximately 3.65%; the repaired workload achieved more than 99.5% on both warm turns. Treat this as evidence of successful warm reuse, not an exact workload-matched improvement ratio. Output counts also differed: 210, 235, and 21 tokens. Neither cache reuse nor connection pooling alone explains the timing differences.

### Connection reuse and remaining lifecycle verification

The relay now uses shared HTTP and HTTPS agents, with at most two idle sockets per destination and no shared admission state or request headers. Request cleanup destroys an active upstream request, not pooled sockets from completed requests. Downstream-close listeners are removed when upstream forwarding settles, and the stream removes its relay-abort listener on failure as well as success.

Diagnostics now report whether Node reused an upstream socket and separate response-header arrival from first response data. These measurements do not isolate DNS or TLS time, and headers-to-first-data is not necessarily time to the first generated token.

TypeScript checking, whitespace checking, and the existing offline startup verification passed. The paid batch verified normal successful HTTPS reuse across request-scoped child processes. Dedicated cancellation and late-cleanup checks have not run. The post-fix batch used exactly the three additional approved paid requests; no further paid calls were made.


## Subsequent lifecycle and benchmark changes

Subprocess writes and child-closure waits now have request-timeout bounds. Read timeouts remove the correct waiter and terminate the child. Cancellation rejects pending reads and writes, and discovery cleanup releases its server and temporary directory even after an exit-observation failure. The completion gate before executable tool calls is unchanged.

Model-request children now use a persistent, empty, private cache directory rather than a new temporary directory per Pi process. See [architecture.md](architecture.md#native-working-directory-srcchild-cwdts) for paths and validation. This removes a changing directory path from native context, but cross-restart API cache reuse remains unmeasured.

The supported `warm` scenario now reproduces the three-turn same-process measurement through installed Pi. It has an explicit three-request budget, private configuration and session cleanup, no-tool enforcement, and a no-model-request dry run. See [testing.md](testing.md#same-process-warm-cache-measurement).

TypeScript checking, compilation, Python and observer syntax checks, offline startup, and RPC dry-run preparation passed. A complete-session loopback-only refusal probe completed 86 historical acknowledgments and reached the deliberately blocked upstream. Both native children exited, and the persistent child directory stayed empty with mode `0700`. That probe verifies replay and failure cleanup, not successful generation. Its model call failed as expected; no paid request was made.

Forced backpressure, hung-child deadlines, cancellation, Windows behavior, and successful paid warm turns after these lifecycle changes remain unverified. The earlier measured 99.59% and 99.71% warm-cache shares are from before these subsequent changes.
