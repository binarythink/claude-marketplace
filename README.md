# claude-marketplace

Personal [Claude Code](https://code.claude.com) mods.

| Mod | Command | Description |
|---|---|---|
| `git-graph` | `/git-graph` | Toggles a side pane showing the working directory's git log as a graph |
| `todo-band` | `/todo` | Toggles a pane showing the session scratchpad's `TODO.jsonl` (or `TODO.md`); its `todo-plan` skill has Claude keep the plan there with dependencies |

Both panes stay closed until you run the command; running it again closes the pane.

## todo-band: `TODO.jsonl`

The `todo-plan` skill has Claude write one JSON object per line to the session scratchpad:

```jsonl
{"id":"api","title":"Implement API","status":"doing","deps":["schema"]}
{"id":"deploy","title":"Deploy to dev1","status":"waiting","deps":["api"],"note":"user syncs ArgoCD"}
```

`status` is `todo`, `doing` (agent running it), `waiting` (waiting on the user to run or confirm something), `done` or `cancelled`. The pane orders items by `deps`, marks a `todo` whose deps are not all `done` as blocked, and flags broken lines, unknown deps and cycles. The full rules are in [`todo-band/skills/todo-plan/SKILL.md`](todo-band/skills/todo-plan/SKILL.md).

## Install

In a Claude Code terminal session:

```
/plugin install git-graph --marketplace binarythink/claude-marketplace
/plugin install todo-band --marketplace binarythink/claude-marketplace
```

Answer `y` to add the marketplace, then pick a scope.

Or from the shell:

```sh
claude plugin marketplace add binarythink/claude-marketplace
claude plugin install git-graph@binarythink
claude plugin install todo-band@binarythink
```

## Update

Bump `version` in the mod's `.claude-plugin/plugin.json` when publishing a change, then:

```sh
claude plugin marketplace update binarythink
claude plugin update git-graph@binarythink
```

## Develop

```sh
claude --plugin-dir ./git-graph   # loads the working copy, reloads on save
claude plugin validate .
claude plugin test ./git-graph
```
