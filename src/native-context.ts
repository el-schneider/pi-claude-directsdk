/**
 * Removes the context that Claude Code adds to every Messages request.
 *
 * Pi owns the prompt: the system prompt, the transcript, and the working
 * directory it reports. The CLI still adds its own context to the request
 * messages, and agents read that context as part of the task:
 *
 * - `role: "system"` messages, such as `# Environment` (the child's private
 *   cache directory as working directory, git state, platform, model name)
 *   and `Today's date is ...`.
 * - A `<system-reminder>` wrapper with sections such as `# userEmail`. It is a
 *   separate text block on the first turn and is appended to the latest
 *   `tool_result` or user text on later turns.
 *
 * The relay removes both before the request goes upstream, so the model sees
 * the same messages as with any other Pi provider. The system prompt blocks,
 * `metadata`, and request parameters are not touched: they carry the CLI's
 * subscription routing and identity.
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

/**
 * A text block that is one whole reminder the wrapper pattern did not consume.
 * Only the CLI writes such blocks; tool output may quote reminders freely.
 */
const UNKNOWN_REMINDER_BLOCK = /^\s*<system-reminder>\n[\s\S]*<\/system-reminder>\s*$/u;

type Block = Record<string, unknown> & { type?: unknown; cache_control?: unknown };

interface Message {
  role?: unknown;
  content?: unknown;
}

class NativeContextError extends Error {
  override name = "NativeContextError";
}

function strip(text: string): string {
  return text.replace(CONTEXT_REMINDER, "");
}

/** Strip one user block. Returns null when nothing but CLI context remains. */
function stripBlock(block: Block): Block | null {
  if (block.type === "text" && typeof block["text"] === "string") {
    const text = strip(block["text"]);
    if (UNKNOWN_REMINDER_BLOCK.test(text)) {
      throw new NativeContextError(
        "Claude Code added a <system-reminder> block in an unknown format; update src/native-context.ts",
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

function systemCacheControl(message: Message): unknown {
  if (typeof message.content === "string") return undefined;
  if (!Array.isArray(message.content)) {
    throw new NativeContextError("Claude Code sent a system message without content");
  }
  let cacheControl: unknown;
  for (const block of message.content as Block[]) {
    if (block.type !== "text") {
      throw new NativeContextError(
        `Claude Code sent a system message with a ${String(block.type)} block; update src/native-context.ts`,
      );
    }
    cacheControl ??= block.cache_control;
  }
  return cacheControl;
}

/** Remove CLI system messages and context reminders from a request payload. */
export function stripNativeContext(payload: { messages?: unknown }): void {
  if (!Array.isArray(payload.messages)) {
    throw new Error("Native request is missing its messages array");
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
