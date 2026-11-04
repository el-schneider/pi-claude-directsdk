/**
 * Removes the context that Claude Code adds to every Messages request.
 *
 * Pi owns the prompt: the system prompt, the transcript, and the working
 * directory it reports. Claude Code still adds its own context to the request
 * messages, and agents read that context as part of the task:
 *
 * - `<system-reminder>` text blocks at the start of the first user message:
 *   `# Environment` (working directory, git state, platform), the model name,
 *   and the current date.
 * - A `<system-reminder>` wrapper with sections such as `# userEmail` and
 *   `# gitStatus`. It is a separate text block on the first turn and can be
 *   appended to the latest `tool_result` or user text on later turns.
 * - For models with mid-conversation system messages, a `role: "system"`
 *   message that carries the environment, model, and date sections instead.
 *
 * The relay (`src/relay.ts`) applies this before the request goes upstream, so
 * the model sees the same messages as with any other Pi provider. The system
 * prompt blocks, `metadata`, and request parameters are not touched: they carry
 * the CLI's subscription routing and identity.
 *
 * A cache breakpoint on removed content moves to the content before it, so the
 * CLI's tail breakpoint keeps caching the newest Pi content.
 *
 * Unknown CLI shapes fail the request. A silent pass-through would leak new
 * context into the conversation after a CLI update.
 */

/**
 * The CLI joins the wrapper to existing text with one newline; only that
 * newline is removed, so Pi's own content stays byte-identical for caching.
 * The fixed footer identifies the CLI wrapper. The header and section names
 * vary ("As you answer the user's questions...", "The session context was
 * re-read..."), so the match spans any content up to that footer.
 */
const CONTEXT_REMINDER =
  /\n?<system-reminder>\n(?:(?!<\/system-reminder>)[\s\S])*?Claude Code attached this context automatically[^\n]*\n<\/system-reminder>\n?/gu;

/** A text block that is one whole reminder the wrapper pattern did not consume. */
const WHOLE_REMINDER_BLOCK = /^\s*<system-reminder>\n([\s\S]*?)\n?<\/system-reminder>\s*$/u;

/**
 * First lines of the context sections Claude Code writes as standalone
 * reminder blocks or as `role: "system"` messages. Only the CLI writes these;
 * tool output may quote reminders freely, but never as a whole user block.
 */
const KNOWN_SECTION_STARTS = [
  "# Environment\n",
  "# Environment update\n",
  "You are powered by the model ",
  "Today's date is ",
  "The date has changed. ",
];

type Block = Record<string, unknown> & { type?: unknown; cache_control?: unknown };

interface Message {
  role?: unknown;
  content?: unknown;
}

export class NativeContextError extends Error {
  override name = "NativeContextError";
}

function isKnownSection(text: string): boolean {
  return KNOWN_SECTION_STARTS.some((start) => text.startsWith(start));
}

function strip(text: string): string {
  return text.replace(CONTEXT_REMINDER, "");
}

/** Strip one user block. Returns null when nothing but CLI context remains. */
function stripBlock(block: Block): Block | null {
  if (block.type === "text" && typeof block["text"] === "string") {
    const text = strip(block["text"]);
    const whole = WHOLE_REMINDER_BLOCK.exec(text);
    if (whole) {
      if (isKnownSection(whole[1] ?? "")) return null;
      throw new NativeContextError(
        `Claude Code added a <system-reminder> block in an unknown format; update src/native-context.ts: ${text.slice(0, 120)}`,
      );
    }
    if (text === block["text"]) return block;
    return text.trim() === "" ? null : { ...block, text };
  }
  if (block.type === "tool_result") {
    const content = block["content"];
    if (typeof content === "string") {
      const stripped = strip(content);
      return stripped === content ? block : { ...block, content: stripped };
    }
    if (Array.isArray(content)) {
      return { ...block, content: stripBlocks(content as Block[]) };
    }
  }
  return block;
}

/** Strip a block list and move breakpoints off removed blocks. */
function stripBlocks(blocks: Block[]): Block[] {
  const kept: Block[] = [];
  let orphanedCache: unknown;
  for (const block of blocks) {
    const result = stripBlock(block);
    if (result === null) {
      orphanedCache ??= block.cache_control;
      continue;
    }
    kept.push(result);
  }
  if (orphanedCache !== undefined) {
    moveCacheControl(kept, orphanedCache);
  }
  return kept;
}

/** Put a breakpoint on the last block that has none. */
function moveCacheControl(blocks: Block[], cacheControl: unknown): void {
  const last = blocks.length - 1;
  const target = blocks[last];
  if (target && target.cache_control === undefined) {
    blocks[last] = { ...target, cache_control: cacheControl };
  }
}

/**
 * Cache breakpoint of a CLI context system message, or undefined when it has
 * none. Throws on a system message that is not CLI context: dropping it could
 * remove something the model needs, keeping it would leak.
 */
function systemCacheControl(message: Message): unknown {
  if (typeof message.content === "string") {
    if (!isKnownSection(message.content)) {
      throw new NativeContextError(
        `Claude Code sent a system message in an unknown format; update src/native-context.ts: ${message.content.slice(0, 120)}`,
      );
    }
    return undefined;
  }
  if (!Array.isArray(message.content) || message.content.length === 0) {
    throw new NativeContextError("Claude Code sent a system message without content");
  }
  let cacheControl: unknown;
  for (const block of message.content as Block[]) {
    if (block.type !== "text" || typeof block["text"] !== "string" || !isKnownSection(block["text"])) {
      throw new NativeContextError(
        `Claude Code sent a system message in an unknown format; update src/native-context.ts: ${JSON.stringify(block).slice(0, 120)}`,
      );
    }
    cacheControl ??= block.cache_control;
  }
  return cacheControl;
}

/** Remove CLI system messages and context reminders from a request payload. */
export function stripNativeContext(payload: { messages?: unknown }): void {
  if (!Array.isArray(payload.messages)) {
    throw new NativeContextError("Native request is missing its messages array");
  }
  const kept: Message[] = [];
  for (const message of payload.messages as Message[]) {
    if (message.role === "system") {
      const cacheControl = systemCacheControl(message);
      const previous = kept[kept.length - 1];
      if (cacheControl !== undefined && Array.isArray(previous?.content)) {
        moveCacheControl(previous.content as Block[], cacheControl);
      }
      continue;
    }
    if (message.role === "user" && Array.isArray(message.content)) {
      kept.push({ ...message, content: stripBlocks(message.content as Block[]) });
      continue;
    }
    kept.push(message);
  }
  payload.messages = kept;
}
