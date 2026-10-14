import type { Artifact, ArtifactKind, ArtifactSource } from '../types'

// URL 하나를 분류한 결과. 어디서 나왔는지(source)는 수집하는 쪽이 붙인다.
export type Link = Omit<Artifact, 'source'>

export const KIND_LABELS: Record<ArtifactKind, string> = {
  pr: 'PR',
  branch: 'Branch',
  jira: 'Jira',
  notion: 'Notion',
  confluence: 'Confluence',
  slack: 'Slack',
  github: 'GitHub',
  web: 'Web',
  file: 'File',
  scratch: 'Scratch',
}

// 파일을 쓰는 도구. 입력의 경로가 산출물이고, 입력 본문의 URL 은 보지 않는다(README 의 설치 URL 같은 잡음).
const FILE_TOOLS: Record<string, string> = {
  Write: 'file_path',
  Edit: 'file_path',
  MultiEdit: 'file_path',
  NotebookEdit: 'notebook_path',
}

// 괄호·따옴표·꺾쇠·백슬래시·비 ASCII 에서 끊는다. 마크다운 링크와 JSON 문자열 안의 URL 도 잡힌다.
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#@!$&*+,;=%]+/g
const TRAILING_RE = /[.,;:!?*]+$/

// 모든 커밋·PR 에 붙는 attribution 과 API 엔드포인트는 산출물이 아니다.
// '…slack', '…atlassian' 처럼 글에서 잘린 host 도 버린다.
const isNoise = (url: URL) =>
  url.host.startsWith('api.')
  || /\.(slack|atlassian|notion|github)$/.test(url.hostname)
  || url.host === 'localhost'
  || (url.host === 'claude.com' && url.pathname.startsWith('/claude-code'))
  || (url.host === 'code.claude.com' && url.pathname.length <= 1)
  || (url.host === 'claude.ai' && url.pathname.startsWith('/code/session_'))

const PROTECTED_BRANCHES = new Set(['main', 'master', 'HEAD', 'develop'])

export const isWorkBranch = (name: string | undefined): name is string =>
  !!name && !name.startsWith('-') && !PROTECTED_BRANCHES.has(name)

const decode = (part: string) => {
  try {
    return decodeURIComponent(part.replace(/\+/g, ' '))
  } catch {
    return part
  }
}

// notion.so/<workspace>/<Title-Words>-<32 hex id> 에서 제목 부분만 남긴다.
const notionTitle = (path: string) => {
  const last = decode(path.split('/').filter(Boolean).pop() ?? '')
  const title = last.replace(/-?[0-9a-f]{32}$/i, '').replace(/-/g, ' ').trim()
  return title || 'Notion page'
}

export const extractUrls = (text: string): string[] =>
  (text.match(URL_RE) ?? []).map(raw => raw.replace(TRAILING_RE, ''))

// URL 하나를 산출물로 분류한다. 잡음이거나 URL 이 아니면 undefined.
export function classifyUrl(raw: string): Link | undefined {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (!/\.[a-z]{2,}$/i.test(url.hostname) || raw.includes('$') || isNoise(url)) return undefined

  const host = url.hostname.toLowerCase()
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'github.com' && parts.length >= 2) {
    const [owner, repo, section, ...rest] = parts
    const base = `https://github.com/${owner}/${repo}`
    if (section === 'pull' && rest[0] === 'new' && rest.length > 1) {
      const branch = decode(rest.slice(1).join('/'))
      return { kind: 'branch', label: branch, href: `${base}/tree/${rest.slice(1).join('/')}` }
    }
    if (section === 'pull' && /^\d+$/.test(rest[0] ?? '')) {
      return { kind: 'pr', label: `${owner}/${repo}#${rest[0]}`, href: `${base}/pull/${rest[0]}` }
    }
    return { kind: 'github', label: parts.join('/'), href: `https://github.com/${parts.join('/')}` }
  }

  if (host.endsWith('.atlassian.net')) {
    const key = url.pathname.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/)?.[1]
      ?? url.searchParams.get('selectedIssue') ?? undefined
    if (key) return { kind: 'jira', label: key, href: `https://${host}/browse/${key}` }
    if (parts[0] === 'wiki') {
      const title = decode(parts[parts.length - 1] ?? '')
      return { kind: 'confluence', label: /^\d+$/.test(title) ? `page ${title}` : title, href: raw }
    }
  }

  if (host === 'notion.so' || host.endsWith('.notion.so') || host.endsWith('.notion.site') || host === 'app.notion.com') {
    return { kind: 'notion', label: notionTitle(url.pathname), href: raw }
  }

  if (host.endsWith('.slack.com') && parts[0] === 'archives' && parts[1]) {
    const ts = parts[2]?.match(/^p(\d{10})(\d*)$/)
    const at = ts ? ` · ${shortTime(Number(ts[1]) * 1000)}` : ''
    return { kind: 'slack', label: `${host.split('.')[0]} ${parts[1]}${at}`, href: raw }
  }

  return { kind: 'web', label: `${host}${url.pathname === '/' ? '' : url.pathname}`, href: raw }
}

// Bash 명령에서 새로 만들거나 push 한 branch 이름을 찾는다.
const BRANCH_RES = [
  /git\s+(?:-C\s+\S+\s+)?(?:checkout|switch)\s+(?:[^\n;&|]*?\s)?-[bBcC]\s+([^\s;&|]+)/g,
  /git\s+(?:-C\s+\S+\s+)?worktree\s+add\s+[^\n;&|]*?-[bB]\s+([^\s;&|]+)/g,
  /git\s+(?:-C\s+\S+\s+)?push\s+[^\n;&|]*?(?:-u|--set-upstream)\s+[^\s;&|-]\S*\s+([^\s;&|:]+)/g,
]

export function branchesFromCommand(command: string): string[] {
  const found: string[] = []
  for (const re of BRANCH_RES) {
    for (const match of command.matchAll(re)) {
      const name = match[1]?.replace(/^['"]|['"]$/g, '')
      if (isWorkBranch(name)) found.push(name)
    }
  }
  return found
}

export type ParsedTranscript = {
  // 사용자가 붙인 제목(/rename). 없으면 aiTitle, 그것도 없으면 firstPrompt 를 쓴다.
  title?: string
  aiTitle?: string
  firstPrompt?: string
  startedAt?: number
  endedAt?: number
  cwd?: string
  // 링크·branch·file 을 처음 수집된 순서대로. 같은 항목이 다시 나와도 처음 출처를 유지한다.
  // file 의 path 는 절대 경로이고, displayPath·href·isGone 은 register 가 채운다.
  artifacts: Artifact[]
}

type Block = {
  type?: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: unknown
}

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g
// 붙여넣은 텍스트는 <pasted_content id="..."> 로 감싸여 저장된다. 태그만 걷고 내용은 남긴다.
const PASTED_TAG_RE = /<\/?pasted_content\b[^>]*>/g

const resultText = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(one => (typeof one?.text === 'string' ? one.text : '')).join('\n')
}

// PR·branch URL 을 남기는 명령. 다른 Bash 명령(grep, cat, 스크립트)의 입출력에 든 URL 은 잡음이다.
const GIT_COMMAND_RE = /(^|[\s;&|(])(gh|git)\s/
// 출력에 새로 만든 것의 URL 을 찍는 git·gh 명령. gh pr view·gh api·git log 같은 조회 명령의 출력은
// PR 본문·커밋 메시지에 든 참고 링크라 보지 않는다.
const CREATING_COMMAND_RE =
  /(^|[\s;&|(])(gh\s+(pr|issue|release)\s+create|git\s+(-C\s+\S+\s+)?push)(\s|$)/
// git·gh 명령의 입출력에서는 GitHub 링크만 남긴다. PR 본문(--body)이나 출력에 든 Jira·Notion 링크는 참고 자료다.
const GIT_KINDS = new Set<ArtifactKind>(['pr', 'branch', 'github'])

// 세션 transcript(JSONL) 한 파일에서 제목·기간·링크·파일·branch 를 모은다.
// 링크는 사용자·assistant 의 글, Bash 가 아닌 도구 입력, git·gh 명령의 입력과 산출물을 만드는 명령의 출력에서만 찾는다.
// 다른 도구 결과(Read, WebFetch, MCP)는 잡음이 많아 보지 않는다.
// transcript 의 gitBranch 는 그때 checkout 된 branch 일 뿐이라, 다른 산출물이 있는 세션에서만 남긴다.
export function parseTranscript(text: string): ParsedTranscript {
  const parsed: ParsedTranscript = { artifacts: [] }
  // 링크는 href, branch 는 이름, file 은 경로로 같은 항목을 가린다.
  const seen = new Map<string, Artifact>()
  const creatingToolIds = new Set<string>()
  const checkedOut: string[] = []

  const add = (key: string, artifact: Artifact) => {
    const known = seen.get(key)
    if (known) {
      // git push 로 URL 이 나중에 생긴 branch 는 처음 출처를 둔 채 URL 만 채운다.
      known.href ??= artifact.href
      return
    }
    seen.set(key, artifact)
    parsed.artifacts.push(artifact)
  }
  const addUrls = (text: string, source: ArtifactSource, kinds?: Set<ArtifactKind>) => {
    for (const raw of extractUrls(text)) {
      const link = classifyUrl(raw)
      if (!link || (kinds && !kinds.has(link.kind))) continue
      if (link.kind === 'branch') addBranch(link.label, source, link.href)
      else add(`link:${link.href ?? link.label}`, { ...link, source })
    }
  }
  const addBranch = (name: string | undefined, source: ArtifactSource, href?: string) => {
    if (isWorkBranch(name)) add(`branch:${name}`, { kind: 'branch', label: name, href, source })
  }
  const addFile = (path: unknown) => {
    if (typeof path !== 'string' || path === '') return
    add(`file:${path}`, { kind: 'file', label: path.split('/').pop() || path, path, source: 'output' })
  }

  for (const line of text.split('\n')) {
    if (line.includes('"custom-title"') || line.includes('"ai-title"')) {
      try {
        const record = JSON.parse(line)
        const custom = record.type === 'custom-title' ? record.customTitle : undefined
        const ai = record.type === 'ai-title' ? record.aiTitle : undefined
        if (typeof custom === 'string' && custom.trim()) parsed.title = custom.trim()
        if (typeof ai === 'string' && ai.trim()) parsed.aiTitle = ai.trim()
      } catch {}
      continue
    }
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue

    let record: {
      type?: string
      isMeta?: boolean
      timestamp?: string
      cwd?: string
      gitBranch?: string
      message?: { content?: unknown }
    }
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type !== 'user' && record.type !== 'assistant') continue

    const at = record.timestamp ? Date.parse(record.timestamp) : NaN
    if (!Number.isNaN(at)) {
      parsed.startedAt ??= at
      parsed.endedAt = at
    }
    if (record.cwd) parsed.cwd = record.cwd
    if (isWorkBranch(record.gitBranch) && !checkedOut.includes(record.gitBranch)) checkedOut.push(record.gitBranch)
    if (record.isMeta) continue

    const content = record.message?.content
    const blocks: Block[] = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content) ? content : []

    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        const body = block.text.replace(REMINDER_RE, '').replace(PASTED_TAG_RE, '').trim()
        if (record.type === 'user' && parsed.firstPrompt === undefined && body && !body.startsWith('<')) {
          parsed.firstPrompt = body.split('\n')[0]!.trim()
        }
        addUrls(body, record.type === 'user' ? 'input' : 'output')
      } else if (block.type === 'tool_use' && block.name) {
        const input = block.input ?? {}
        const pathKey = FILE_TOOLS[block.name]
        if (pathKey) {
          addFile(input[pathKey])
          continue
        }
        if (block.name === 'Bash') {
          const command = typeof input.command === 'string' ? input.command : ''
          if (!GIT_COMMAND_RE.test(command)) continue
          if (block.id && CREATING_COMMAND_RE.test(command)) creatingToolIds.add(block.id)
          for (const name of branchesFromCommand(command)) addBranch(name, 'output')
          addUrls(command, 'output', GIT_KINDS)
          continue
        }
        addUrls(JSON.stringify(input), 'output')
      } else if (block.type === 'tool_result' && creatingToolIds.has(block.tool_use_id ?? '')) {
        addUrls(resultText(block.content), 'output', GIT_KINDS)
      }
    }
  }

  if (parsed.artifacts.length > 0) {
    for (const name of checkedOut) addBranch(name, 'output')
  }
  return parsed
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// 10/15 01:02
export const shortTime = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export const clockTime = (ms: number) => {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// 같은 날이면 끝 시각만, 다르면 둘 다.
export const spanOf = (startedAt?: number, endedAt?: number) => {
  if (startedAt === undefined) return ''
  const start = shortTime(startedAt)
  if (endedAt === undefined || endedAt - startedAt < 60_000) return start
  const end = shortTime(endedAt)
  return start.slice(0, 5) === end.slice(0, 5) ? `${start}–${end.slice(6)}` : `${start} – ${end}`
}

// Claude Code 는 프로젝트별 폴더 이름을 경로의 영숫자 아닌 글자를 '-' 로 바꿔 만든다.
export const slugOf = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-')

// git worktree list --porcelain 의 worktree 경로들
export const parseWorktrees = (stdout: string): string[] =>
  stdout.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice('worktree '.length).trim())

// displayPath 결과에서 파일 이름을 뺀 폴더 부분. worktree root 의 파일은 '.', 다른 worktree 의 root 는 'x:' 이다.
export function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  if (slash >= 0) return path.slice(0, slash) || '/'
  const colon = path.indexOf(':')
  return colon >= 0 ? path.slice(0, colon + 1) : '.'
}

// 경로를 가장 긴 worktree 기준 상대 경로로 줄인다. 다른 worktree 면 그 폴더 이름을 앞에 붙이되,
// '<main 폴더>-' 로 시작하면 그 부분은 뺀다 (repo-feature → feature:).
export function displayPath(path: string, roots: string[], home?: string): string {
  const root = [...roots].sort((a, b) => b.length - a.length).find(one => path.startsWith(`${one}/`))
  if (root) {
    const relative = path.slice(root.length + 1)
    if (root === roots[0]) return relative
    const main = roots[0]?.split('/').pop() ?? ''
    const name = root.split('/').pop() ?? root
    return `${main && name.startsWith(`${main}-`) ? name.slice(main.length + 1) : name}:${relative}`
  }
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}
