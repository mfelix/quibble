# Quibble

Adversarial AI document review CLI that iterates between Codex (reviewer) and Claude (author) until consensus is reached. Quibble is designed for markdown documents and keeps a resumable session history on disk by default.

## Requirements

- Node.js >= 18
- OpenAI Codex CLI available on PATH (`codex`)
- Anthropic Claude Code CLI available on PATH (`claude`)

## Install

```bash
npm install
npm run build
```

### Running locally (no global install)

```bash
node dist/index.js <file>
```

### Optional: `npm link` for development

If you are working on this repo and want a global `quibble` command without publishing:

```bash
npm link
```

## Usage

```bash
quibble <file>
```

Example:

```bash
quibble docs/plan.md
```

## CLI Options

```text
--json             Output structured JSONL events
--debug-claude     Log raw Claude stream lines for debugging
--debug-codex      Log raw Codex stream lines for debugging
--dry-run          Show resolved config and exit
--keep-debug       Keep debug logs after a successful run
--max-rounds <n>   Maximum review cycles before forced stop (default: 5)
--no-persist       Disable session storage; runs in-memory only
--output <path>    Output path for final document
--resume <id>      Resume a previous session by ID
--session-dir <p>  Override session storage location
--verbose          Show detailed progress
```

## How It Works

Each round has three phases:

1. Codex reviews the document and returns issues/opportunities.
2. Claude responds, updates the document, and assesses consensus.
3. Codex checks whether the response resolves the feedback.

The loop stops when consensus is approved, the max rounds are reached, or a failure occurs.

## Output Files

Quibble writes a final document next to the input by default:

```
<input>-quibbled.md
```

It also writes session artifacts (unless `--no-persist`) under:

```
.quibble/sessions/<session-id>/
```

Typical session layout:

```
.quibble/sessions/<session-id>/
  manifest.json
  round-1/
    codex-review.json
    claude-response.json
    codex-consensus.json
    document-v1.md
  final/
    document.md
    summary.json
  debug/
    claude-stream-round-1.log
    codex-stream-round-1.log
```

## JSONL Output

When `--json` is set, Quibble emits one JSON object per line with event types:

- `start`, `round_start`
- `codex_review`, `codex_progress`
- `claude_progress`, `claude_response`
- `consensus`, `complete`, `error`

This is useful for CI or custom UIs.

## Exit Codes

- `0`: Completed successfully (or max rounds reached with no unresolved critical/major issues)
- `1`: Max rounds reached with unresolved major issues
- `2`: Failure or unresolved critical issues

## Debugging

If Claude or Codex progress appears stuck, enable debug logs:

```bash
quibble example.md --debug-claude --debug-codex --keep-debug
```

Logs are written to the session `debug/` directory. By default they are deleted after a successful run; use `--keep-debug` to retain them.

## Development

```bash
npm run build
npm run typecheck
npm test
```

## Troubleshooting

- Ensure `codex` and `claude` are on PATH.
- If the CLI times out, re-run with debug flags and inspect the logs.
- For large documents, increase `--max-rounds` or edit prompts in `src/prompts/`.
