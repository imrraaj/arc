<p align="center">
  <img src="./logo.png" alt="Arc" width="180" />
</p>

# Arc

Arc is a small terminal agent harness. The idea is the same general shape as Claude Code, Codex, or OpenCode: run an LLM inside a project directory, give it tools, keep the conversation around, and let it work on the repo with approval gates for anything risky.

This is not trying to be a giant framework. It is a moderate implementation that is easy to read and change. The main pieces are:

- an OpenTUI terminal app
- an agent loop built on the Vercel AI SDK
- NVIDIA-hosted OpenAI-compatible models
- local file, grep, command, skill, web, and subagent tools
- SQLite-backed sessions and tool-call history
- JSON settings for user-level config like the NVIDIA API key
- markdown prompts in `src/prompts`

## Running it

Install dependencies:

```bash
bun install
```

Start the app from the project you want Arc to work on:

```bash
bun run start
```

Run typecheck:

```bash
bun run typecheck
```

The workspace root is the directory where the command is started. File tools and command tools resolve paths against that root and block paths that escape it.

## First run

On first run Arc asks for a NVIDIA API key in the terminal UI. It stores that key centrally at:

```text
~/.arc/config.json
```

The key is not stored in the project folder. This keeps every repo from getting its own scattered config file.

Settings are intentionally still JSON because they are simple user preferences. Sessions are not JSON anymore; they live in SQLite.

## Models

The currently configured models are in `src/utils/config.ts`:

- `qwen/qwen3.5-122b-a10b`
- `moonshotai/kimi-k2.5`
- `z-ai/glm5`
- `minimaxai/minimax-m2.7`


You can switch models from the command palette. Switching the model does not clear the conversation. The current messages, summary, tool-call history, and token counts stay attached to the current session, and the next turn is sent to the newly selected model.

## UI

Arc runs as a terminal app using OpenTUI.

The layout is simple:

- main conversation pane
- input box
- model and generating indicator
- sidebar with token/message status
- command palette
- approval modal
- API key modal

Keyboard controls:

- `ctrl+k` opens the command palette
- `esc` exits when idle
- `esc` cancels generation or memory compaction when a turn is running
- `enter` submits input or confirms modal actions

The command palette currently supports:

- change model
- create a new session
- switch to an existing session
- view token usage
- clear history
- show welcome screen by starting a fresh session

## Agent loop

The main agent loop lives in `src/agent.ts`.

For every user prompt Arc:

1. Adds the user message to the current session.
2. Checks whether the current context should be compacted.
3. Builds the model message list.
4. Streams the assistant response into the UI.
5. Handles tool approval requests.
6. Sends approval responses back into the model loop.
7. Stores the final assistant message and tool-call state.

The loop uses `streamText` with `stepCountIs(5)`, so a single turn can do a few tool-use steps before stopping. This keeps the agent useful without letting one prompt run forever.

Tool calls that require approval are shown in the UI before they run. The user can approve or deny them. Approved calls move to `running` and then `completed`; denied calls are recorded as `denied`.

## Tools

Tools are defined under `src/tools`.

### `read_file`

Reads a file from the workspace. Paths can be relative or absolute, but they must stay inside the workspace root.

This does not require approval because it only reads.

### `apply_patch`

Applies a unified diff patch to one file.

The tool requires:

- `path`
- `patch`

The patch is passed through the approval UI before execution, so the user approves the actual diff instead of a vague write request. Patches apply with zero fuzz; if the file has drifted and the patch no longer matches cleanly, the tool returns an error instead of guessing.

This requires approval.

### `create_file`

Creates a new file and any missing parent directories.

This requires approval because it writes to disk.

### `createDir`

Creates a directory recursively.

This is used by the subagent tool. At the moment it does not require approval on its own, so if this gets exposed to the main agent later we should probably review that.

### `readDir`

Lists a directory and returns each entry as either `file` or `directory`.

### `grep`

Runs `rg` with JSON output and returns matching file, line, and line number.

This gives the model a cheap way to search the repo without reading every file manually.

### `run_command`

Runs a shell command through `sh -c` in the workspace.

This requires approval.

It also has a few guardrails:

- command cwd is constrained to the workspace
- output is truncated after `config.tools.command.maxOutputBytes`
- command timeout defaults to 30 seconds
- timeout is capped at 120 seconds
- commands are killed on timeout or abort
- obvious destructive patterns like `rm -rf /`, `mkfs`, shutdown/reboot, and fork bombs are blocked before execution

This is still a shell. The approval gate matters.

### `web_search`

Uses Tavily for web search.

This requires approval. It currently reads `TAVILY_API_KEY` from the environment. NVIDIA auth moved into Arc settings, but Tavily has not been moved yet.

### `discoverSkills`

Scans configured skill directories and returns skill names and descriptions.

By default Arc looks in:

```text
<workspace>/.agents
```

That means skills are loaded from the project where Arc was started, not from Arc's own repo folder.

### `load_skill`

Loads a skill by name.

Skills are markdown files named `SKILL.md` with YAML frontmatter:

```md
---
name: example-skill
description: What this skill helps with
---

Skill instructions go here.
```

The tool strips the frontmatter and returns the body as instructions for the model.

This requires approval because loading a skill can change the model's behavior for the turn.

### `subagent`

Runs a smaller tool-using agent for a specific prompt.

The subagent gets its own model call and a smaller toolset:

- `readFile`
- `applyPatch`
- `createFile`
- `createDir`
- `readDir`

It uses the same NVIDIA API key and can optionally run with a different model. If no model is provided, it uses the default model.

This requires approval because it can perform file edits through its own tools.

Subagents are useful when the main model needs a bounded helper task, like reading a few files or making a focused patch, without stuffing every detail into the main conversation.

### `compact_memory`

Requests memory compaction.

The current implementation exposes this as a tool and returns a compaction request object. Automatic compaction is already handled by the app before a turn is sent when the token estimate crosses the threshold.

## Memory and context

Arc keeps the raw messages for the session, but it does not blindly send infinite history.

The memory settings are in `src/utils/config.ts`:

```ts
memory: {
  windowSize: 10,
  contextWindow: 32000,
  safetyBuffer: 2000,
  compactionThreshold: 0.9,
}
```

Before each turn, Arc estimates tokens using a simple character-based estimate. If the current conversation plus the pending prompt reaches the configured threshold, Arc compacts older messages.

Compaction works like this:

1. Keep the last `windowSize` messages as recent context.
2. Summarize older messages using the selected model.
3. Add the summary back as a system message.
4. Store the summary in the current session.

If a session already has a stored summary, that summary is added to the next model call before the messages. This is what lets a session keep useful context without always replaying everything.

This is not perfect memory. It is a practical rolling-summary approach that is good enough for a small harness and easy to reason about.

## Sessions

Arc supports multiple sessions, closer to threads than plain chat logs.

You can:

- create a new session
- switch to an old session
- clear the current session
- keep model choice per session
- keep message history per session
- keep tool calls per session
- keep cumulative token usage per session
- keep the compacted conversation summary per session

Sessions are stored centrally in SQLite at:

```text
~/.arc/arc.db
```

The current session id is stored in the `app_state` table. On startup Arc loads the current session if it exists, otherwise it falls back to the latest session, otherwise it creates a new one.
SQLite uses WAL mode. Messages and tool calls are normalized into their own tables instead of being stored as one giant JSON blob, so it is easier to inspect or query the database later.

## Tool-call storage

Tool calls are not just UI events. They are persisted with the session.

For each tool call Arc stores:

- id
- session id
- assistant message index
- tool name
- args as JSON
- result as JSON when available
- error as JSON when a tool fails
- status
- timestamp
- started/completed timestamps
- duration in milliseconds

The UI groups tool calls by the assistant message index so the transcript can show which assistant turn produced which tool activity. Tool calls that are still pending or running are shown separately until they are attached to the final assistant message.

## Prompts

Prompts are markdown files under:

```text
src/prompts
```

Current prompt files:

- `system.md`
- `subagent.md`
- `summarizer-system.md`
- `summarizer-user.md`

`src/prompts/index.ts` loads them at runtime and exposes them through config. Keeping prompts as markdown makes them easier to edit without touching TypeScript strings.

## Config

Most knobs live in:

```text
src/utils/config.ts
```

That includes:

- app name/version
- available models
- default model
- storage paths
- file permissions
- memory thresholds
- UI context window display
- prompts
- command timeout/output limits
- blocked shell-command patterns
- skill directories

The goal is to avoid scattering constants across the codebase.

## Filesystem safety

Arc treats the directory where it was started as the workspace root:

```ts
export const WORKSPACE_ROOT = resolve(process.cwd());
```

All file paths go through `resolveWorkspacePath`. If a path escapes the workspace root, the tool throws.

This is not a full sandbox. It is a workspace boundary check plus approval gates for write/command tools.


## Current limitations

Some things are intentionally still simple:

- token counting is approximate
- shell execution is approval-gated but not a real OS sandbox
- Tavily still uses `TAVILY_API_KEY` from the environment
- the UI currently shows the last 10 messages instead of a full transcript browser
- subagents do not have their own persisted sessions yet

That is fine for now. The point of this codebase is to keep the harness understandable while still having the core pieces: tools, approvals, memory, model switching, sessions, and local project context.
