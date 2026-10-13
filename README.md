# claude-marketplace

Personal [Claude Code](https://code.claude.com) mods.

| Mod | Command | Description |
|---|---|---|
| `git-graph` | `/git-graph` | Toggles a side pane showing the working directory's git log as a graph |
| `todo-band` | `/todo` | Toggles a pane showing the session scratchpad's `TODO.md` |

Both panes stay closed until you run the command; running it again closes the pane.

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
