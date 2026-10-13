import type { GraphLine } from '../types'

const SEP = '\x1f'

export const GIT_LOG_ARGV = [
  'git', 'log', '--graph', '--all', '--decorate=short', '--color=never',
  '--date=short', `--format=${SEP}%h${SEP}%D${SEP}%s${SEP}%an${SEP}%ad`, '-n', '300',
] as const

// `git log --graph` 출력 한 줄을 graph 접두부와 commit 필드로 나눈다.
// commit 이 없는 줄(분기·병합 연결선)은 graph 만 가진다.
export const parseGraphLog = (stdout: string): GraphLine[] =>
  stdout
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => {
      const at = line.indexOf(SEP)
      if (at < 0) return { graph: line.trimEnd() }
      const [hash, refs, subject, author, date] = line.slice(at + 1).split(SEP)
      return { graph: line.slice(0, at), hash, refs: refs || undefined, subject, author, date }
    })

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
