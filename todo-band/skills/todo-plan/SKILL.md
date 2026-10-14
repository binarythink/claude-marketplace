---
name: todo-plan
description: Use when starting any task with three or more steps, or when the user asks to plan, track, or show a TODO list. Writes and maintains the session plan as TODO.jsonl in the session scratchpad, with dependencies between items, so the todo-band pane (/todo) can show progress, what is blocked, and what is waiting on the user. Also use whenever an item's state changes — starting it, handing it to the user, finishing or cancelling it.
---

# TODO.jsonl

Keep the plan for the current task in `TODO.jsonl` in this session's scratchpad directory (the path is in the system prompt). The todo-band mod polls that file and draws it in the `/todo` pane; it prefers `TODO.jsonl` over `TODO.md`, so do not write both.

## Schema

One JSON object per line, no surrounding array, no trailing commas, no comments.

| Field | Required | Type | Meaning |
|---|---|---|---|
| `id` | yes | string | Short kebab-case key, unique in the file (`schema`, `api-impl`). Never renamed once written — other items' `deps` point at it. |
| `title` | yes | string | What the step does, one line, in the user's language. |
| `status` | yes | string | One of the values below. |
| `deps` | no | string[] | `id`s that must be `done` before this item can start. Omit or `[]` when there are none. |
| `note` | no | string | One line of context: why it is waiting, what the user must run, a PR link, the reason for cancelling. |

### `status`

| Value | Who acts | Use when |
|---|---|---|
| `todo` | — | Not started. The pane derives "blocked" from `deps` by itself; never write a blocked status. |
| `doing` | agent | You are executing it now — editing, running commands, investigating. |
| `waiting` | user | You handed it to the user: they must run something (a deploy, a command needing their credentials, a manual check) or confirm a result before you continue. Put what you are waiting for in `note`. |
| `done` | — | Finished and verified. |
| `cancelled` | — | Dropped. Put the reason in `note`. |

```jsonl
{"id":"schema","title":"정산 테이블 DDL 작성","status":"done"}
{"id":"api","title":"정산 조회 API 구현","status":"doing","deps":["schema"]}
{"id":"dev-deploy","title":"dev1 배포","status":"waiting","deps":["api"],"note":"사용자가 ArgoCD sync 후 결과 확인"}
{"id":"test","title":"통합 테스트","status":"todo","deps":["api","dev-deploy"]}
{"id":"batch","title":"야간 배치 연동","status":"cancelled","note":"이번 범위에서 제외"}
```

## Rules

1. **Create the file before the first step.** Break the task into items, write every item as `todo` with its `deps`, then set the first item to `doing`.
2. **Change one line at a time.** Update an item with the Edit tool, matching its whole line (it is unique because of `id`). Rewrite the whole file only when restructuring the plan.
3. **Append new items at the end.** The pane orders items by their dependencies itself; file order only breaks ties.
4. **Keep `deps` valid.** Reference only `id`s that exist in the file; no item may depend on itself, directly or through a cycle. The pane flags unknown ids and cycles in red.
5. **Update status as it happens, not in batches.**
   - Starting a step → `doing`.
   - Asking the user to run or confirm something → `waiting`, with `note`, before you end your turn.
   - When the user reports back → `doing` again while you check, then `done`.
   - Finished → `done` immediately; verify first if the step has a check.
6. **Only one `doing` at a time**, unless you really run steps in parallel (for example, subagents).
7. **Cancelling an item** does not unblock its dependents — only `done` does. When you cancel, also remove its `id` from other items' `deps`, or cancel those items too.
8. **Do not paste the file into chat.** The user sees it in the `/todo` pane; mention only what changed when it matters.

## When auto-todo is on

The user turns this on with `/auto-todo on`; each of their prompts then carries a note saying so. While it is on:

- **Track every request that asks for work**, even a one-step one — not only tasks with three or more steps. A question that needs no edits, commands or investigation gets no item.
- **Append, do not restart.** When a new request arrives, add its items at the end of the existing `TODO.jsonl` and keep earlier items, `done` ones included, as the session's history. Create the file only if there is none.
- **Use only `TODO.jsonl`** for progress, not the built-in TodoWrite or Task tools.
- When a note says your last turn did not update `TODO.jsonl`, bring it up to date with what that turn did before continuing.

When a note says auto-todo was turned off, stop updating the file on your own; change it only when the user asks.
