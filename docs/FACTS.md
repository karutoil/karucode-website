# Facts — the only source of truth for copy

Every number and claim on this site must come from this file. If something is not
here, it is not true for our purposes: **do not invent it**. All of it is taken from
the karucode repository (`README.md`, `reports/bench.md`, `docs/SECURITY.md`,
`branding/BRAND.md`) at the time this project started.

## Identity

| | |
| --- | --- |
| Name | `karucode` — one word, lowercase, no space, no camel case, never `K` or `KaruCode` |
| Tagline (short, canonical) | One binary, not a stack. |
| Hero headline | A coding agent that is one binary, not a stack. |
| Positioning | Minimal, not bloated. The claim is measured: 10.5 MiB binary, 10.2 MiB idle RSS, one SQLite file. "Self-hosted" is true but no longer differentiating — keep it as a fact, never as the headline. |
| Facts line | 10.5 MiB binary · 10.2 MiB idle RSS · one SQLite file · no Node at runtime |
| Licence | MIT |
| Language | Rust 1.89+ |
| Repo | https://github.com/karutoil/karucode |
| Runtime deps | none for the frontend: the UI is embedded in the binary and needs no Node at runtime |
| Platforms | Linux is the primary target; other Unixes should work |
| Telemetry | none in the product. (No analytics claim on the site unless the site itself has none — it doesn't.) |

Wordmark: Inter Bold, `-0.04em` tracking, `karu` in text colour and `code` in the accent.

## What it does

- **Adjective-free summary:** a coding agent, delivered as one 10.5 MiB Rust binary that
  embeds its own UI and keeps all state in one SQLite file. Nothing else to deploy.
- Reads your project, searches it, edits files, runs commands with streamed output,
  inspects git, delegates to subagents, and keeps going through multi-step tasks until
  the work is done or you stop it.
- **Long-horizon runs.** The iteration budget belongs to a *segment*. When it runs out
  mid-task the runtime refreshes it and continues in the same session, run and
  transcript. Ceiling ≈ `(max_continues + 1) × max_iterations` = **10,200 turns** with
  the defaults, or a **24 h** wall clock, whichever comes first.
- **Real side effects.** Every tool result is bounded with an explicit truncation
  marker — never silently dropped.
- **Approvals before mutations.** `ask` is the default for shell and writes.
- **Containment for file tools.** Every path resolves through a confined workspace.
- **Crash-tolerant.** On restart, leftover `running` runs become `interrupted` and
  pending approvals `expired`; nothing is silently retried.
- **Self-documenting.** Facts about karucode are written as `@kc-doc` comments next to
  the code that implements them and compiled into the binary, so docs cannot drift from
  the build. The model reads them through the read-only `karucode_docs` tool.

## Architecture (from README)

```
browser (Preact UI, served by the same origin)
      REST + SSE
karucode — one Rust binary
├─ axum API + SSE .. embedded UI, same origin
├─ agent loop ...... approvals, subagents, budgets
├─ provider ........ any OpenAI-compatible endpoint
├─ tools ........... files, search, shell, git, docs
├─ plugins + MCP ... out of process, namespaced
└─ SQLite (WAL) .... projects, sessions, runs, agents
```

## Tools

Read, search, write and edit files; run shell commands with streamed output in their
own process group; inspect git; spawn subagents; read karucode's own documentation.
Tool execution within a turn is **sequential**, deliberately, for deterministic
approvals and events.

## Approvals

- Default mode `ask` for shell and writes.
- Modes: `ask`, `ask_commands`, `auto`, `read_only`
  (`KARUCODE_APPROVAL_MODE`).
- Command-prefix allowlists (`KARUCODE_ALLOW_COMMANDS`), per-path auto-approval.
- In the UI: allow-once / allow-for-session / deny, all audited.
- `KARUCODE_LOCK_SETTINGS=1` removes the UI settings layer so a deployment can pin
  settings from the environment and reject browser edits with `403`.
- `KARUCODE_ADMIN_TOKEN` is required to change approvals or the endpoint.

## Containment

- Confined workspace: no `..` escapes, no absolute paths outside, symlink escapes
  canonicalised away, writes atomic.
- The system temp dir is an extra root by default (`KARUCODE_ALLOW_TEMP_DIR=true`).
- **Shell commands are explicitly not sandboxed.** Approvals are the gate, not
  isolation. Say this plainly; it is a trust feature, not a footnote.

## Subagents

- Concurrency default 3 (`KARUCODE_SUBAGENT_CONCURRENCY`), live detached agents per
  session default 8 (`KARUCODE_SUBAGENT_MAX_BACKGROUND`).
- Subagents share the parent's live workspace, including dirty and untracked files.
  `owned_paths` is advisory conflict reporting, not a lock.
- Recursive subagents are off by default (`KARUCODE_ALLOW_RECURSIVE_SUBAGENTS=false`).

## Providers

- Anything that speaks the OpenAI chat-completions API with streaming tool calls.
- Named profiles, a model library, model metadata, retries.
- Providers are install-wide, not per project; a *session* can pin its own provider,
  model and reasoning effort.

## Plugins and MCP

- Plugins are separate processes (not Wasm), namespaced; no filesystem sandbox and no
  hot reload of a changed binary.
- MCP supports stdio and streamable HTTP; tools only — resources and prompts are not
  surfaced. Legacy SSE-only transport is not implemented.

## Security posture

- Binds to loopback by default; a non-loopback bind requires an auth token (≥16 chars).
- DNS-rebinding defence: with a loopback bind and no token, only `127.0.0.1`,
  `localhost` and `[::1]` Hosts are served. `KARUCODE_ALLOWED_HOSTS` extends the list.
- Browser clients are CSRF-protected: a custom header plus the Origin/Host check.
- Child processes get a credential-free environment allowlist, so a prompt-injected
  `curl` cannot exfiltrate the harness token or the provider key.
- Secrets are never returned to the browser or written to logs.
- Markdown is rendered with raw HTML disabled and then sanitised. A chat artifact is a
  separate document in a sandboxed opaque-origin frame with a random per-artifact
  capability — never the master token.
- No built-in TLS: put a reverse proxy in front for remote access.

## Performance (measured, not promised)

From `reports/bench.md`, host: AMD Ryzen 7 3700X, Linux 6.12, rustc 1.96, release build
with strip + thin LTO. Methodology: temp SQLite DB, local streaming mock provider, no
network; cold start polled on `/api/health`; RSS sampled after 3 s idle and during 3
concurrent runs.

| Metric | Value |
| --- | --- |
| Cold start | **7.9 ms** average (10.1 / 5.7 across runs) |
| Idle RSS | **10.2 MiB** average |
| Peak RSS, 3 concurrent runs | **12.4 MiB** |
| Binary size | **10.5 MiB** |
| 3 concurrent runs, wall time | 158.9 ms |

Always show these with the caveat: numbers are specific to that host and to the mock
provider; RSS during a real run also depends on the provider TLS stack and response
sizes. Never present them as a guarantee or a comparison.

## Configuration precedence (highest first)

1. overrides saved from the UI (SQLite `settings` table)
2. environment variables
3. the config file — `KARUCODE_CONFIG`, default `~/.config/karucode/config.toml`
4. built-in defaults

## Key environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `KARUCODE_HOST` / `KARUCODE_PORT` | `127.0.0.1` / `8787` | bind address; a non-loopback bind needs a token |
| `KARUCODE_WORKSPACE` | cwd | default workspace root |
| `KARUCODE_DATA_DIR` | `~/.local/share/karucode` | SQLite database + plugin data, mode `0700` |
| `KARUCODE_AUTH_TOKEN` | unset | bearer token for remote access (≥16 chars) |
| `KARUCODE_ADMIN_TOKEN` | unset | required to change approvals or the endpoint |
| `KARUCODE_PROJECT_ROOTS` | unset (any dir) | colon-separated allowlist for new project roots |
| `KARUCODE_ALLOW_TEMP_DIR` | `true` | let file tools also reach the system temp dir |
| `KARUCODE_BASE_URL` | `http://127.0.0.1:4000/v1` | OpenAI-compatible base URL |
| `KARUCODE_API_KEY` | unset | provider key (falls back to `OPENAI_API_KEY`) |
| `KARUCODE_MODEL` | `gpt-4o-mini` | model id |
| `KARUCODE_APPROVAL_MODE` | `ask` | `ask`, `ask_commands`, `auto`, `read_only` |
| `KARUCODE_ALLOW_COMMANDS` | empty | command prefixes that are never prompted for |
| `KARUCODE_MAX_ITERATIONS` | `200` | model turns per segment |
| `KARUCODE_MAX_CONTINUES` | `50` | budget refreshes per run |
| `KARUCODE_MAX_RUN_SECS` | `86400` | hard wall clock for a whole run |
| `KARUCODE_COMMAND_TIMEOUT_SECS` | `120` | default shell timeout |
| `KARUCODE_MAX_TOOL_OUTPUT_BYTES` | `24000` | tool result bytes kept for the model |
| `KARUCODE_CONTEXT_MAX_CHARS` | `0` | `0` = derive from the model's window |
| `KARUCODE_SUBAGENT_CONCURRENCY` | `3` | concurrent subagents (`0` = no ceiling) |
| `KARUCODE_SUBAGENT_MAX_BACKGROUND` | `8` | live detached agents per session |
| `KARUCODE_ALLOW_RECURSIVE_SUBAGENTS` | `false` | nested delegation |
| `KARUCODE_LOG` | `info` | tracing filter, e.g. `info,karucode=debug` |
| `KARUCODE_ALLOWED_HOSTS` | empty | extra `Host` names for the loopback guard |

## Install paths (real commands only)

```bash
git clone https://github.com/karutoil/karucode && cd karucode
export KARUCODE_BASE_URL=http://127.0.0.1:4000/v1   # your gateway
export KARUCODE_API_KEY=sk-...                     # if the gateway needs one
export KARUCODE_MODEL=gpt-4o-mini
cargo run --release -p kc-server -- --workspace /path/to/your/project
```

Then open <http://127.0.0.1:8787>. `cargo build` also builds and embeds the frontend,
so that is the whole build. Prerequisites: Linux, Rust 1.89+, Node 22.12+ **only to
build the frontend**. Optional: ripgrep (a pure-Rust fallback is built in) and git.

Container and systemd installs live under `packaging/` in the repo. There is no hosted
service, no pricing, no signup. **There is no `curl | bash` installer** — do not invent
one. Do not write a download button that goes nowhere.

## Known limitations — state these plainly

- **No shell sandbox.** Commands run as the server user. Use a container or VM for
  untrusted code or unattended `auto` mode.
- **Subagents share the live workspace**, including dirty and untracked files;
  `owned_paths` is advisory, not locking.
- **Sequential tool execution** within a turn.
- **MCP**: stdio and streamable HTTP only; tools only.
- **Plugins** are processes, not Wasm: no filesystem sandbox, no hot reload.
- **Providers are install-wide, not per project.**
- **No built-in TLS** — use a reverse proxy.
- **Compaction is trimming**, not model-assisted summarisation.
- Token accounting is whatever the provider reports; absent usage is shown as unknown.

## Claims we must not make

These are the tempting ones. All are false or unverified:

- ❌ "Sandboxed shell" / "secure sandbox" — the shell is explicitly **not** sandboxed.
- ❌ "Fastest", "blazing", "10× better", any comparative benchmark.
- ❌ "Works on Windows" for the server.
- ❌ "Free tier", "pricing", "sign up", "book a demo", any growth CTA.
- ❌ "SOC 2", "audited", "enterprise-grade", "bank-level encryption".
- ❌ "Zero data leaves your machine" — it calls your provider's endpoint.
- ❌ Any user count, download count, star count, or quote from a user.
- ❌ Any feature not in this file: no cloud sync, no mobile app, no team workspaces,
  no built-in model, no voice, no browser automation.
