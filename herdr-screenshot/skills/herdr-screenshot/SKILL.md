---
name: herdr-screenshot
description: Use when the user asks to screenshot, capture, or save as an image the terminal screen of a Herdr pane — the current pane or another one ("이 화면 캡처해줘", "pane 스크린샷", "w7G:p1 찍어줘", "scrollback 까지 이미지로"). Renders the pane's ANSI dump to PNG with headless Chrome, so it works without macOS screen recording permission. Requires HERDR_ENV=1 and Google Chrome.
---

# herdr-screenshot

Herdr pane 의 터미널 화면을 PNG 로 저장한다. `herdr pane read --format ansi` 로 덤프한 내용을 `scripts/ansi2html.py` 로 HTML 변환하고, Headless Chrome 으로 렌더링한다. macOS `screencapture` 는 화면 기록 권한이 없으면 `could not create image from display` 로 실패하므로 쓰지 않는다.

## 실행

이 스킬의 base directory 아래 `scripts/cap.sh` 를 실행한다. **sandbox 밖에서 실행해야 한다** (herdr 소켓 접근과 Chrome 실행이 sandbox 안에서는 실패한다).

```sh
<skill-dir>/scripts/cap.sh --out <session-scratchpad-dir> [--pane <id>] [--title <text>] [--lines N]
```

| 인자 | 기본값 | 의미 |
|---|---|---|
| `--pane <id>` | `$HERDR_PANE_ID` (현재 pane) | 찍을 pane. 다른 pane id 는 `herdr pane list` 로 확인 |
| `--out <png\|dir>` | `$TMPDIR` | 파일 경로면 그대로, 디렉터리면 그 안에 `screen-<YYYYMMDD-HHMMSS>.png`. **사용자가 위치를 지정하지 않았으면 세션 scratchpad 디렉터리를 넘긴다** |
| `--title <text>` | pane id | 이미지 상단 창 제목 바에 표시할 문자열 |
| `--lines N` | 없음 (`--source visible`) | 지정하면 `--source recent --lines N` 으로 scrollback 을 포함해 찍는다. 높이는 내용에 맞춰 늘어난다 |

stdout 에 `<PNG 절대경로> (<너비>x<높이> css px)` 한 줄을 출력한다. 실제 PNG 픽셀은 2배(`--force-device-scale-factor=2`)다. 결과를 보여줄 때는 그 경로를 Read 로 열어 확인한 뒤 경로를 안내한다.

## 전제 조건

- `HERDR_ENV=1`, `herdr` 실행 파일, `python3`
- Google Chrome (`/Applications/Google Chrome.app`). 다른 위치면 `HERDR_SHOT_CHROME` 환경 변수로 실행 파일 경로 지정
- 폰트 `D2KodingLigature Nerd Font` (없으면 `JetBrainsMono NF` → `Menlo` 순으로 대체). 대체 폰트로 렌더링되면 한글이 섞인 줄의 정렬이 어긋날 수 있다

조건이 맞지 않으면 `cap.sh: ...` 오류를 stderr 에 내고 종료 코드 1 로 끝난다.

## 렌더링 방식과 유지할 사항

1. **2단계 렌더링** — 4000×4000 창에서 `--dump-dom` 으로 열어 `document.fonts.ready` 이후 `.win` 의 실제 크기를 측정하고, 그 크기로 스크린샷을 찍는다. 창 크기를 고정하면 `--hide-scrollbars` 때문에 넓은 pane 의 오른쪽이 오류 없이 잘린다 (예: 1300px 고정 창에서 156칸 pane 콘텐츠 1358px 가 잘림).
2. **폰트** — `"D2KodingLigature Nerd Font","JetBrainsMono NF","Menlo",monospace`. 이 폰트는 ASCII 7px, 한글 14px 로 정확히 2배다. `... Nerd Font Mono` 변형은 한글을 1칸 폭으로 눌러 쓰므로 쓰지 않는다. `"D2Coding"` 은 설치 이름이 아니어서 대체된다.
3. **전각 폭 고정** — East Asian Width 가 W/F 인 문자는 `<span class="w">` 로 감싸고 `.w{display:inline-block;width:2ch}` 로 2칸을 고정한다. 폰트가 없거나 이모지여도 박스 테두리(`│`) 정렬이 유지된다.

## 범위 밖

다른 pane 의 에이전트에 프롬프트를 넣고 결과를 찍는 시나리오 촬영은 이 스킬에 포함하지 않는다. 필요하면 `herdr agent prompt` 로 먼저 입력하고, 출력이 끝난 뒤 이 스킬로 찍는다.
