# claude-marketplace

Personal [Claude Code](https://code.claude.com) mods.

| Mod | Command | Description |
|---|---|---|
| `git-graph` | `/git-graph` | Toggles a side pane showing the working directory's git log as a graph |
| `pii-guard` | — | Checks each prompt for personal data before it is sent: blocks Korean unique identifiers, asks before sending phone numbers, emails, cards, accounts, addresses and attachments |
| `session-outputs` | `/outputs` | Toggles a pane listing what the current session produced — PRs, branches, Jira/Notion/Confluence/Slack links, edited files, scratchpad files — grouped by kind |
| `todo-band` | `/todo`, `/auto-todo` | Toggles a pane showing the session scratchpad's `TODO.jsonl` (or `TODO.md`); its `todo-plan` skill has Claude keep the plan there with dependencies, and `/auto-todo` has Claude keep it up to date on every request |
| `herdr-screenshot` | — | Its `herdr-screenshot` skill saves a Herdr pane's screen as a PNG by rendering the pane's ANSI dump in headless Chrome |

The panes stay closed until you run the command; running it again closes the pane.

## todo-band: `TODO.jsonl`

The `todo-plan` skill has Claude write one JSON object per line to the session scratchpad:

```jsonl
{"id":"api","title":"Implement API","status":"doing","deps":["schema"]}
{"id":"deploy","title":"Deploy to dev1","status":"waiting","deps":["api"],"note":"user syncs ArgoCD"}
```

`status` is `todo`, `doing` (agent running it), `waiting` (waiting on the user to run or confirm something), `done` or `cancelled`. The pane orders items by `deps`, marks a `todo` whose deps are not all `done` as blocked, and flags broken lines, unknown deps and cycles. The full rules are in [`todo-band/skills/todo-plan/SKILL.md`](todo-band/skills/todo-plan/SKILL.md).

### `/auto-todo [on|off]`

Without auto-todo, `TODO.jsonl` exists only once Claude picks the `todo-plan` skill for a multi-step task, and later requests in the session go untracked. With `/auto-todo on`, every prompt you type carries a hidden instruction to keep `TODO.jsonl` current: work requests (edits, commands, investigation) are appended as items and their statuses updated; questions that need no work get none. If a turn edits files or runs commands but leaves `TODO.jsonl` untouched, the next prompt also carries a one-time reminder.

- No argument toggles; the pane header shows `auto ●` (on) or `auto ○` (off).
- The setting lasts for the session only. To start every session on, set the plugin option `autoTodoDefault` to `true` in `/config`.
- `/auto-todo off` stops the instruction and tells Claude once to stop updating the file on its own; the file and the pane stay.

## pii-guard: 전송 전 개인정보 확인

프롬프트(붙여넣은 텍스트 포함)와 `@경로`로 참조한 파일을 전송 전에 검사한다.

| 처리 | 유형 |
|---|---|
| 확인 없이 차단 | 주민등록번호·외국인등록번호(구분자 있는 형식), 여권번호·운전면허번호(키워드 또는 구분자 형식) |
| "그래도 보낼까요?" 확인 | 구분자 없는 13자리 주민번호 형식, 휴대전화, 이메일, 카드(Luhn), 계좌(키워드), 주소(시·도~번지), 이미지·문서 첨부 |

- 대화상자와 차단 사유에는 유형과 건수만 표시하고 감지한 값은 표시하지 않는다.
- 막힌 프롬프트는 엔진이 입력창에 되돌려 두므로 값을 지우고 다시 보낼 수 있다.
- 물어볼 수 없는 경우(`-p`, SDK)나 검사 중 오류가 나면 보내지 않는다(fail-closed).
- 모델이 도구로 읽는 파일·명령 출력은 검사하지 않는다. 첨부 이미지·문서는 내용 검사 없이 확인만 한다.

## herdr-screenshot: pane 화면 PNG 저장

Herdr pane 안에서 "이 화면 캡처해줘" 처럼 요청하면 스킬이 `scripts/cap.sh` 를 실행한다.

```sh
cap.sh [--pane <id>] [--out <png|dir>] [--title <text>] [--lines N]
```

- 기본은 현재 pane(`$HERDR_PANE_ID`)의 보이는 화면. `--lines N` 이면 scrollback 포함
- 측정 패스로 콘텐츠 크기를 잰 뒤 그 크기로 2배 해상도 스크린샷을 찍으므로 넓은 pane 도 잘리지 않는다
- 필요: Google Chrome, 폰트 `D2KodingLigature Nerd Font` (한글 2칸 정렬용)

## session-outputs: 세션 산출물 뷰어

`/outputs` 로 pane 을 열고 닫는다. 현재 진행 중인 세션의 transcript(`~/.claude/projects/<slug>/<session id>.jsonl`)와 scratchpad 를 읽어 종류별로 묶어 보여준다. 다른 세션의 산출물은 보이지 않는다.

| 종류 | 출처 |
|---|---|
| PR · Branch | `github.com/.../pull/N` URL, `git checkout -b`·`git worktree add -b`·`git push -u` 명령, `pull/new/<branch>` URL, 세션 중 checkout 된 branch |
| Jira · Confluence · Notion · Slack · GitHub · Web | 사용자·assistant 의 글, 도구 입력(MCP 호출 포함), `git`·`gh` 명령의 입출력에 나온 URL |
| File | `Write`·`Edit`·`NotebookEdit` 로 만든 파일 (지금 없으면 `(deleted)`) |
| Scratch | 세션 scratchpad 의 파일 (`/tmp` 라 재부팅 후에는 사라진다) |

- `r` 로 다시 읽는다. 열려 있으면 10초마다 갱신한다
- pane 에 포커스가 있을 때 `j`/`k` 로 한 item 씩 이동하고, `c` 는 선택한 item 의 이름, `p` 는 경로(파일은 절대 경로, 링크는 URL, URL 없는 branch 는 이름)를 클립보드에 복사한다
- 4 MiB 가 넘는 transcript 는 `tail -c` 로 나눠 읽는다 (`$.fs.read` 상한)
- 링크·파일은 클릭하면 열린다 (OSC 8 hyperlink)
- attribution 링크(`claude.ai/code/session_…`, `claude.com/claude-code`), `api.*` 엔드포인트, Read·WebFetch 등 도구 결과 속 URL 은 잡음이라 제외한다

## Install

In a Claude Code terminal session:

```
/plugin install git-graph --marketplace binarythink/claude-marketplace
/plugin install todo-band --marketplace binarythink/claude-marketplace
/plugin install pii-guard --marketplace binarythink/claude-marketplace
/plugin install herdr-screenshot --marketplace binarythink/claude-marketplace
/plugin install session-outputs --marketplace binarythink/claude-marketplace
```

Answer `y` to add the marketplace, then pick a scope.

Or from the shell:

```sh
claude plugin marketplace add binarythink/claude-marketplace
claude plugin install git-graph@binarythink
claude plugin install todo-band@binarythink
claude plugin install pii-guard@binarythink
claude plugin install herdr-screenshot@binarythink
claude plugin install session-outputs@binarythink
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
