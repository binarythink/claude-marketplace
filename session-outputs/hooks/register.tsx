import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiPressArgument } from 'claude-code'

import type { Artifact, ArtifactIndex, ArtifactKind, ArtifactSource } from '../types'
import type { ParsedArtifact, ParsedTranscript } from './parse'
import {
  KIND_LABELS, clockTime, dirOf, displayPath, parseTranscript, parseWorktrees, slugOf, spanOf,
} from './parse'

const PANE = 'session-outputs'
const TITLE = 'Session outputs'
const POLL_MS = 10_000
const TMP_ROOTS = ['/private/tmp', '/tmp']
const SCRATCH_DEPTH = 2
// $.fs.read 와 $.process.run 의 stdout 은 4 MiB 까지라, 그보다 큰 transcript 는 나눠 읽는다.
const READ_LIMIT = 4 * 1024 * 1024
// 명령을 보낸 시각(assistant 메시지 기록 시각)과 파일 mtime 사이의 시계 오차 여유
const WRITTEN_SLACK_MS = 5_000

const indexAtom = atom({ plugin: 'session-outputs', key: 'index' } as const, {} as ArtifactIndex)
// j/k 로 고르는 item 의 순번. 화면에 그린 순서(출처별 묶음) 기준이다.
const selectedAtom = atom({ plugin: 'session-outputs', key: 'selected' } as const, 0)

// 그룹을 그리는 순서와 제목
const GROUPS: { source: ArtifactSource; title: string }[] = [
  { source: 'output', title: 'output' },
  { source: 'input', title: 'input' },
]

const KIND_COLORS: Record<ArtifactKind, string> = {
  pr: 'green',
  branch: 'cyan',
  jira: 'blue',
  notion: 'white',
  confluence: 'blue',
  slack: 'magenta',
  github: 'gray',
  web: 'gray',
  file: 'yellow',
  scratch: 'yellow',
}

// transcript 는 수 MB 라 mtime·size 가 그대로면 다시 읽지 않는다. reload 하면 비워진다.
let cached: { path: string; mtimeMs: number; size: number; parsed: ParsedTranscript } | undefined
let isRefreshing = false

const paneOf = async ($: EngineInterface) =>
  (await $.ui.panes()).find(pane => pane.id === PANE)

// 이 저장소의 worktree 들. 첫 줄이 main worktree 다. git 이 아니면 세션 root 하나.
// 파일 경로를 줄이는 데 쓰고, transcript·scratchpad 폴더 이름(slug) 후보이기도 하다.
async function worktreeRoots($: EngineInterface): Promise<string[]> {
  const root = await $.session.root()
  try {
    const { exitCode, stdout } = await $.process.run(['git', 'worktree', 'list', '--porcelain'], { cwd: root, timeoutMs: 10_000 })
    const roots = exitCode === 0 ? parseWorktrees(stdout) : []
    if (roots.length > 0) return roots
  } catch {}
  return [root]
}

// <tmp>/claude-<uid> 폴더들. 세션 scratchpad 는 그 아래 <project slug>/<session id>/scratchpad 에 있다.
async function tmpBases($: EngineInterface): Promise<string[]> {
  const custom = await $.env.get('CLAUDE_CODE_TMPDIR')
  // macOS 의 /tmp 는 /private/tmp 의 symlink 라 실제 경로로 한 번만 센다.
  const bases = new Map<string, string>()
  for (const root of custom ? [custom, ...TMP_ROOTS] : TMP_ROOTS) {
    const entries = await $.fs.list(root).catch(() => [])
    for (const one of entries) {
      if (one.kind !== 'dir' || !one.name.startsWith('claude-')) continue
      const base = `${root}/${one.name}`
      const real = (await $.fs.stat(base, { resolve: true }).catch(() => undefined))?.realPath ?? base
      if (!bases.has(real)) bases.set(real, base)
    }
  }
  return [...bases.values()]
}

async function scratchFiles($: EngineInterface, dir: string, prefix = '', depth = 0): Promise<string[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const files: string[] = []
  for (const one of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (one.kind === 'file') files.push(`${prefix}${one.name}`)
    else if (one.kind === 'dir' && depth < SCRATCH_DEPTH) {
      files.push(...await scratchFiles($, `${dir}/${one.name}`, `${prefix}${one.name}/`, depth + 1))
    }
  }
  return files
}

// tail -c +<offset> 의 앞 4 MiB 에서 마지막 줄바꿈까지만 쓰고, 그 UTF-8 바이트 수만큼 offset 을 넘긴다.
// 잘린 끝 줄(멀티바이트 글자가 잘렸을 수도 있다)은 다음 조각에서 처음부터 다시 읽힌다.
async function readLarge($: EngineInterface, path: string): Promise<string> {
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let offset = 0
  for (;;) {
    const { exitCode, stdout, stderr, isStdoutTruncated } =
      await $.process.run(['tail', '-c', `+${offset + 1}`, path], { timeoutMs: 30_000 })
    if (exitCode !== 0) throw new Error(stderr.trim() || `tail exited with ${exitCode}`)
    if (!isStdoutTruncated) {
      chunks.push(stdout)
      return chunks.join('')
    }
    const end = stdout.lastIndexOf('\n')
    if (end < 0) throw new Error(`${path}: a line over 4 MiB`)
    const whole = stdout.slice(0, end + 1)
    chunks.push(whole)
    offset += encoder.encode(whole).length
  }
}

async function readTranscript($: EngineInterface, path: string, mtimeMs: number, size: number, home?: string) {
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs && cached.size === size) return cached.parsed
  const text = size < READ_LIMIT ? await $.fs.read(path) : await readLarge($, path)
  const parsed = parseTranscript(text, home)
  cached = { path, mtimeMs, size, parsed }
  return parsed
}

// Bash 가 쓴 파일 중 경로가 실행 결과에 달린 것의 지금 경로. 찾지 못하면 undefined 라 목록에서 뺀다.
// - cp a dir: dir 이 폴더면 그 안의 a
// - cp f "f.bak.$(date +%s)": 이름이 맞고 명령을 보낸 뒤 고쳐진 파일 중 가장 먼저 고쳐진 것
async function settlePath($: EngineInterface, one: ParsedArtifact & { path: string }): Promise<string | undefined> {
  if (one.intoDirName) {
    const stat = await $.fs.stat(one.path).catch(() => undefined)
    return stat?.kind === 'dir' ? `${one.path}/${one.intoDirName}` : one.path
  }
  if (!one.namePattern) return one.path
  const dir = one.path.slice(0, one.path.lastIndexOf('/')) || '/'
  const name = new RegExp(one.namePattern)
  const after = (one.writtenAt ?? 0) - WRITTEN_SLACK_MS
  const [first] = (await $.fs.list(dir).catch(() => []))
    .filter(entry => entry.kind === 'file' && name.test(entry.name) && entry.mtimeMs >= after)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
  return first && `${dir === '/' ? '' : dir}/${first.name}`
}

// 현재 세션의 transcript 와 scratchpad 만 읽는다.
// transcript 는 <config>/projects/<세션을 시작한 폴더의 slug>/<session id>.jsonl 이라, 시작 폴더 후보를 차례로 본다.
async function buildIndex($: EngineInterface): Promise<ArtifactIndex> {
  const home = await $.env.get('HOME')
  const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  if (!configDir) return { error: 'HOME is not set', loadedAt: Date.now() }

  const [id, root, cwd, roots, bases] =
    await Promise.all([$.session.id(), $.session.root(), $.session.cwd(), worktreeRoots($), tmpBases($)])
  const slugs = [...new Set([root, cwd, ...roots].map(slugOf))]

  let transcript: { path: string; mtimeMs: number; size: number } | undefined
  for (const slug of slugs) {
    const path = `${configDir}/projects/${slug}/${id}.jsonl`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind === 'file') {
      transcript = { path, mtimeMs: stat.mtimeMs, size: stat.size }
      break
    }
  }
  // 새 세션은 첫 프롬프트를 보내기 전까지 transcript 가 없다. 오류가 아니라 아직 산출물이 없는 상태다.
  if (!transcript) return { loadedAt: Date.now() }

  const parsed = await readTranscript($, transcript.path, transcript.mtimeMs, transcript.size, home)
  const artifacts: Artifact[] = []
  const files = new Set<string>()
  for (const { namePattern, writtenAt, intoDirName, ...one } of parsed.artifacts) {
    if (one.kind !== 'file' || !one.path) {
      artifacts.push(one)
      continue
    }
    const path = await settlePath($, { ...one, path: one.path, namePattern, writtenAt, intoDirName })
    // scratchpad 에 쓴 파일은 아래 Scratch 로 보인다.
    if (!path || files.has(path) || path.includes(`/${id}/scratchpad/`)) continue
    files.add(path)
    const exists = await $.fs.exists(path).catch(() => false)
    artifacts.push({
      ...one,
      label: path.split('/').pop() || path,
      path,
      displayPath: displayPath(path, roots, home),
      href: exists ? `file://${path}` : undefined,
      isGone: !exists,
    })
  }
  scratch: for (const base of bases) {
    for (const slug of slugs) {
      const pad = `${base}/${slug}/${id}/scratchpad`
      if (!(await $.fs.exists(pad).catch(() => false))) continue
      for (const name of await scratchFiles($, pad)) {
        const path = `${pad}/${name}`
        artifacts.push({
          kind: 'scratch',
          label: name.split('/').pop() ?? name,
          href: `file://${path}`,
          path,
          displayPath: displayPath(path, roots, home),
          source: 'output',
        })
      }
      break scratch
    }
  }

  const prompt = parsed.firstPrompt
  return {
    session: {
      id,
      title: parsed.title ?? parsed.aiTitle ?? (prompt ? (prompt.length > 60 ? `${prompt.slice(0, 59)}…` : prompt) : '(untitled)'),
      cwd: parsed.cwd,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt ?? transcript.mtimeMs,
      artifacts,
    },
    loadedAt: Date.now(),
  }
}

async function refresh($: EngineInterface): Promise<ArtifactIndex | undefined> {
  if (isRefreshing) return undefined
  isRefreshing = true
  try {
    let index: ArtifactIndex
    try {
      index = await buildIndex($)
    } catch (err) {
      index = { ...(await read($, indexAtom)), error: String(err), loadedAt: Date.now() }
    }
    await update($, indexAtom, () => index)
    return index
  } finally {
    isRefreshing = false
  }
}

// 화면에 그리는 순서: 출처별로 묶고, 한 그룹 안에서는 세션에 처음 나온 순서(scratchpad 파일은 맨 끝).
const orderOf = (artifacts: Artifact[]) =>
  GROUPS.flatMap(group => artifacts.filter(one => one.source === group.source))

// 행의 path 칸: 파일은 줄인 경로, 링크는 URL. URL 없는 branch 는 비운다.
// 파일은 name 칸이 이미 파일 이름이라 폴더만 보인다.
const locationOf = (one: Artifact) => (one.displayPath === undefined ? one.href : dirOf(one.displayPath))

// p 가 복사하는 값: 파일은 절대 경로, 링크는 URL, URL 없는 branch 는 이름.
const pathOf = (one: Artifact) => one.path ?? one.href ?? one.label

const itemKey = (n: number) => `item-${n}`

const summaryOf = (index: ArtifactIndex) => {
  const count = index.session?.artifacts.length ?? 0
  return `${count} artifact${count === 1 ? '' : 's'}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'outputs',
      description: 'Toggle the pane showing what this session produced: PRs, branches, Jira/Notion/Slack links, files',
    })
    // reload 로 session.start 가 다시 불려도 pane 이 열려 있을 때만 읽는다.
    if (await paneOf($).catch(() => undefined)) void refresh($).catch(() => undefined)
    $.clock.every(POLL_MS, () => {
      void (async () => {
        if (await paneOf($)) await refresh($)
      })().catch(() => undefined)
    })

    return next(e)
  })

  // /outputs 는 pane 을 열고 닫는 toggle 이다. 세션 시작 시 자동으로 열지 않는다.
  // 다른 탭 뒤에 열려 있으면 닫지 않고 앞으로 가져온다.
  on('command.run', { command: 'outputs' }, async $ => {
    const pane = await paneOf($)
    if (pane?.isShown) {
      await $.ui.close({ id: PANE })
      return { text: 'Session outputs pane closed.' }
    }
    if (pane) {
      // 열린 id 를 다시 open 하면 제목만 바뀌고 탭은 그대로라, 닫았다 열어 맨 앞 탭으로 올린다.
      await $.ui.close({ id: PANE })
      await $.ui.open({ id: PANE, title: TITLE })
      void refresh($).catch(() => undefined)
      return { text: 'Session outputs pane brought to front.' }
    }
    const index = await refresh($) ?? await read($, indexAtom)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: index.error ? `Session outputs: ${index.error}` : `Session outputs pane opened: ${summaryOf(index)}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const index = await read($, indexAtom)
    const session = index.session
    const items = orderOf(session?.artifacts ?? [])
    // 다시 읽어 item 이 줄었으면 마지막 item 에 머문다.
    const selected = Math.min(await read($, selectedAtom), Math.max(0, items.length - 1))

    // 키를 연달아 누르면 다시 그리기 전에 다음 press 가 오므로, 그린 시점의 selected 가 아니라 atom 의 지금 값을 쓴다.
    const clamp = (n: number) => Math.min(items.length - 1, Math.max(0, n))
    const move = (delta: number) => async () => {
      if (items.length === 0) return
      let next = 0
      await update($, selectedAtom, current => (next = clamp(clamp(current) + delta)))
      await $.ui.scroll({ to: { key: itemKey(next) }, in: PANE }).catch(() => undefined)
    }
    const copy = (what: 'name' | 'path') => async (press: UiPressArgument) => {
      const item = items[clamp(await read($, selectedAtom))]
      if (!item) return
      const text = what === 'name' ? item.label : pathOf(item)
      const { isCopied } = await $.ui.copy({ text, surface: press.surface })
      await $.ui.toast(isCopied ? `Copied ${what}: ${text}` : `Could not copy the ${what}`)
    }

    const name = (one: Artifact) => one.isGone
      ? <Text dimColor strikethrough>{`${one.label} (deleted)`}</Text>
      : <Text>{one.label}</Text>
    // path 칸은 흐리게 그린다. 링크는 URL 칸 자체를 Link 로 둔다. OSC 8 을 못 그리는 터미널은
    // Link 글자 뒤에 URL 을 덧붙이므로, 글자 없이 href 만 주어야 URL 이 한 번만 보인다.
    // 파일은 같은 이유로 Link 를 쓰지 않는다(폴더 뒤에 file:// URL 이 붙는다).
    const location = (one: Artifact) => {
      const text = locationOf(one)
      if (!text) return null
      return (
        <Text dimColor>
          {'  '}
          {one.displayPath === undefined && one.href ? <Link href={one.href} /> : text}
        </Text>
      )
    }

    // 행은 type, name, path 순이다. type 칸은 이 pane 에 보이는 가장 긴 종류 이름에 맞춘다.
    const typeWidth = Math.max(0, ...items.map(one => KIND_LABELS[one.kind].length))
    let n = 0
    const groups = GROUPS.flatMap(group => {
      const rows = items.filter(one => one.source === group.source)
      if (rows.length === 0) return []
      return [(
        <Box key={`g-${group.source}`} flexDirection="column" marginTop={1}>
          <Text bold>{`▸ ${group.title} (${rows.length})`}</Text>
          {rows.map(one => {
            const at = n++
            const isSelected = at === selected
            return (
              <Box key={itemKey(at)}>
                <Text wrap="truncate-end">
                  <Text color="cyan" bold>{isSelected ? '› ' : '  '}</Text>
                  <Text color={KIND_COLORS[one.kind]}>{`${KIND_LABELS[one.kind].padEnd(typeWidth)}  `}</Text>
                  {isSelected ? <Text inverse>{name(one)}</Text> : name(one)}
                  {location(one)}
                </Text>
              </Box>
            )
          })}
        </Box>
      )]
    })

    const loaded = index.loadedAt ? ` · updated ${clockTime(index.loadedAt)}` : ''

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
          <Text dimColor wrap="truncate-end">{`${summaryOf(index)}${loaded}`}</Text>
        </Box>
        {items.length > 0 && (
          <Box flexDirection="row" gap={2}>
            <Button key="next" label="Next" hotkey="j" plain onPress={() => void move(1)()} />
            <Button key="prev" label="Prev" hotkey="k" plain onPress={() => void move(-1)()} />
            <Button key="copy-name" label="Copy name" hotkey="c" plain onPress={press => void copy('name')(press)} />
            <Button key="copy-path" label="Copy path" hotkey="p" plain onPress={press => void copy('path')(press)} />
          </Box>
        )}
        {session && (
          <Text wrap="truncate-end">
            <Text bold>{session.title}</Text>
            <Text dimColor>{`  ${[spanOf(session.startedAt, session.endedAt), session.id.slice(0, 8)].filter(Boolean).join(' · ')}`}</Text>
          </Text>
        )}
        {index.error && <Text color="red">{index.error}</Text>}
        {!index.error && !index.loadedAt && <Text dimColor>Reading the session transcript…</Text>}
        {index.loadedAt && !index.error && items.length === 0 && <Text dimColor>No artifacts in this session yet.</Text>}
        {groups}
      </Box>
    )
  })
}
