import type { GraphLine, Ref, RepoStatus } from '../types'

const SEP = '\x1f'

export const GIT_LOG_ARGV = [
  'git', 'log', '--graph', '--all', '--decorate=full', '--color=never',
  `--format=${SEP}%h${SEP}%P${SEP}%D${SEP}%s${SEP}%an${SEP}%at`, '-n', '300',
] as const

export const GIT_STATUS_ARGV = ['git', 'status', '--porcelain=v2', '--branch'] as const

// `git log --graph` 출력 한 줄을 graph 접두부와 commit 필드로 나눈다.
// commit 이 없는 줄(분기·병합 연결선)은 graph 만 가진다.
export const parseGraphLog = (stdout: string): GraphLine[] =>
  stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const at = line.indexOf(SEP)
      if (at < 0) return { graph: line.trimEnd() }
      const [hash, parents, refs, subject, author, time] = line.slice(at + 1).split(SEP)
      return {
        graph: line.slice(0, at),
        hash,
        refs: refs || undefined,
        subject,
        author,
        time: Number(time) || undefined,
        isMerge: (parents ?? '').trim().split(/\s+/).length > 1,
      }
    })

// `--decorate=full` 의 `%D` 를 종류별 ref 로 나눈다.
export const parseRefs = (refs: string): Ref[] =>
  refs.split(', ').filter(Boolean).map((ref): Ref => {
    if (ref === 'HEAD') return { name: 'HEAD', kind: 'head' }
    if (ref.startsWith('HEAD -> refs/heads/')) return { name: `HEAD -> ${ref.slice(19)}`, kind: 'head' }
    if (ref.startsWith('tag: refs/tags/')) return { name: `tag: ${ref.slice(15)}`, kind: 'tag' }
    if (ref.startsWith('refs/heads/')) return { name: ref.slice(11), kind: 'local' }
    if (ref.startsWith('refs/remotes/')) return { name: ref.slice(13), kind: 'remote' }
    return { name: ref.replace(/^refs\//, ''), kind: 'other' }
  })

// `git status --porcelain=v2 --branch` 에서 branch·upstream·ahead/behind·변경 파일 수를 읽는다.
export const parseStatus = (stdout: string): RepoStatus => {
  const status: RepoStatus = { ahead: 0, behind: 0, changed: 0 }
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice(14)
      if (head !== '(detached)') status.branch = head
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice(18)
    } else if (line.startsWith('# branch.ab ')) {
      const [ahead, behind] = line.slice(12).split(' ')
      status.ahead = Math.abs(Number(ahead)) || 0
      status.behind = Math.abs(Number(behind)) || 0
    } else if (line.length > 0 && !line.startsWith('#')) {
      status.changed += 1
    }
  }
  return status
}

// commit graph 를 바꾸는 git 하위 명령. status·diff·log 같은 읽기 전용 명령은 제외한다.
const MUTATING_GIT =
  /\bgit\s+(?:-\S+\s+(?:\S+\s+)?)*(?:commit|checkout|switch|merge|rebase|reset|pull|fetch|push|branch|tag|cherry-pick|revert|stash|am|restore|worktree|clone|init|gc|filter-branch)\b/

export const changesGraph = (command: string): boolean => MUTATING_GIT.test(command)

// graph 접두부의 ASCII 문자를 box-drawing 글리프로 바꾼다. 모두 1셀 폭이다.
const GLYPHS: Record<string, string> = { '|': '│', '/': '╱', '\\': '╲', '-': '─' }

export const glyphOf = (ch: string, isMerge = false): string =>
  ch === '*' ? (isMerge ? '◉' : '●') : GLYPHS[ch] ?? ch

// commit 시각을 현재 기준 상대 시간으로 줄여 쓴다.
export const relativeTime = (seconds: number, nowMs: number): string => {
  const diff = Math.max(0, Math.floor(nowMs / 1000 - seconds))
  if (diff < 60) return 'just now'
  const units: [number, string][] = [[31_536_000, 'y'], [2_592_000, 'mo'], [604_800, 'w'], [86_400, 'd'], [3_600, 'h'], [60, 'm']]
  const [size, unit] = units.find(([size]) => diff >= size)!
  return `${Math.floor(diff / size)}${unit} ago`
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export const clockTime = (ms: number): string => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 터미널 셀 기준 폭: 한글·CJK·전각 문자는 2칸.
const cellWidth = (ch: string): number => {
  const cp = ch.codePointAt(0) ?? 0
  const isWide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)
  return isWide ? 2 : 1
}

export const widthOf = (text: string): number =>
  [...text].reduce((sum, ch) => sum + cellWidth(ch), 0)

// 셀 폭 `room` 안에 들어가도록 자르고, 잘렸으면 끝에 `…` 을 붙인다.
export const cutToWidth = (text: string, room: number): string => {
  if (room <= 0) return ''
  if (widthOf(text) <= room) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellWidth(ch)
    if (used + w > room - 1) break
    out += ch
    used += w
  }
  return `${out}…`
}

// 색이 다른 조각들을 이어 붙인 문자열을 `room` 셀 안에 맞춘다. 넘치는 조각은 잘리고 그 뒤는 버린다.
export const fitPieces = <P extends { text: string }>(pieces: P[], room: number): P[] => {
  const out: P[] = []
  let left = room
  for (const piece of pieces) {
    const w = widthOf(piece.text)
    if (w <= left) {
      out.push(piece)
      left -= w
      continue
    }
    const cut = cutToWidth(piece.text, left)
    if (cut) out.push({ ...piece, text: cut })
    break
  }
  return out
}
