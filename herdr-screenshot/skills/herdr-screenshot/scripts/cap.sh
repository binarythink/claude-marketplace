#!/bin/zsh
# usage: cap.sh [--pane <id>] [--out <png|dir>] [--title <text>] [--lines N]
# Herdr pane 화면을 ANSI 덤프 → HTML → Headless Chrome 으로 렌더링해 PNG 로 저장한다.
set -e
SP=${0:A:h}
CHROME=${HERDR_SHOT_CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

die() { echo "cap.sh: $*" >&2; exit 1; }

PANE=${HERDR_PANE_ID:-}; OUT=""; TITLE=""; LINES_N=""
while (( $# )); do
  case $1 in
    --pane)  PANE=$2; shift 2 ;;
    --out)   OUT=$2; shift 2 ;;
    --title) TITLE=$2; shift 2 ;;
    --lines) LINES_N=$2; shift 2 ;;
    -h|--help) sed -n '2,3p' $0 | sed 's/^# //'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ ${HERDR_ENV:-} == 1 ]] || die "HERDR_ENV=1 이 아님 (Herdr pane 안에서 실행해야 함)"
command -v herdr >/dev/null || die "herdr 실행 파일을 찾을 수 없음"
[[ -x $CHROME ]] || die "Google Chrome 을 찾을 수 없음: $CHROME (HERDR_SHOT_CHROME 으로 지정 가능)"
[[ -n $PANE ]] || die "pane id 없음 (--pane 지정 또는 HERDR_PANE_ID 필요)"
[[ -z $LINES_N || $LINES_N == <1-> ]] || die "--lines 는 양의 정수여야 함: $LINES_N"

STAMP=$(date +%Y%m%d-%H%M%S)
[[ -n $OUT ]] || OUT=${TMPDIR:-/tmp}
[[ -d $OUT ]] && OUT=$OUT/screen-$STAMP.png
OUT=${OUT:A}
mkdir -p ${OUT:h}
TITLE=${TITLE:-$PANE}

TMP=$(mktemp -d); trap 'rm -rf $TMP' EXIT
if [[ -n $LINES_N ]]; then
  herdr pane read "$PANE" --source recent --lines $LINES_N --format ansi > $TMP/s.ansi
else
  herdr pane read "$PANE" --source visible --format ansi > $TMP/s.ansi
fi
python3 -I $SP/ansi2html.py $TMP/s.ansi $TMP/s.html "$TITLE"

# 1차(측정): 넉넉한 창에서 폰트 로드 후 .win 의 실제 크기를 잰다.
# 창 크기를 고정하면 --hide-scrollbars 때문에 넓은 pane 의 오른쪽이 소리 없이 잘린다.
cat >> $TMP/s.html <<'JS'
<script>document.fonts.ready.then(()=>{const r=document.querySelector('.win').getBoundingClientRect();
document.body.dataset.size=Math.ceil(r.right+16)+','+Math.ceil(r.bottom+16)})</script>
JS
SIZE=$("$CHROME" --headless=new --disable-gpu --window-size=4000,4000 --virtual-time-budget=2000 \
  --dump-dom file://$TMP/s.html 2>/dev/null | grep -o 'data-size="[0-9,]*"' | grep -o '[0-9,]*' || true)
[[ -n $SIZE ]] || die "크기 측정 실패 (Chrome --dump-dom 결과에 data-size 없음)"

# 2차(렌더): 측정한 크기로 2배 해상도 스크린샷
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
  --window-size=$SIZE --screenshot=$OUT file://$TMP/s.html >/dev/null 2>&1
[[ -s $OUT ]] || die "스크린샷 저장 실패: $OUT"
echo "$OUT (${SIZE/,/x} css px)"
