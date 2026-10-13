import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphLine, GraphLog, RefKind, RepoStatus } from '../types'
import {
  GIT_LOG_ARGV, GIT_STATUS_ARGV, changesGraph, clockTime, cutToWidth, fitPieces, glyphOf,
  parseGraphLog, parseRefs, parseStatus, relativeTime, widthOf,
} from './parse'

const PANE = 'git-graph'
const TITLE = 'Git graph'
const logAtom = atom({ plugin: 'git-graph', key: 'log' } as const, { lines: [] } as GraphLog)
const offsetAtom = atom({ plugin: 'git-graph', key: 'offset' } as const, 0)

// graph 열마다 색을 돌려 branch 선을 구분한다.
const LANE_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'] as const

const REF_COLORS: Record<RefKind, string> = {
  head: 'cyan',
  local: 'green',
  remote: 'red',
  tag: 'yellow',
  other: 'magenta',
}

type Piece = { text: string; color?: string; bold?: boolean; dimColor?: boolean }

async function readStatus($: EngineInterface): Promise<RepoStatus | undefined> {
  try {
    const { exitCode, stdout } = await $.process.run(GIT_STATUS_ARGV, { timeoutMs: 10_000 })
    return exitCode === 0 ? parseStatus(stdout) : undefined
  } catch {
    return undefined
  }
}

async function refresh($: EngineInterface): Promise<GraphLog> {
  let log: GraphLog
  try {
    const [{ exitCode, stdout, stderr }, status] = await Promise.all([
      $.process.run(GIT_LOG_ARGV, { timeoutMs: 10_000 }),
      readStatus($),
    ])
    log = exitCode === 0
      ? { lines: parseGraphLog(stdout), status, loadedAt: Date.now() }
      : { lines: [], error: stderr.trim() || `git log exited with ${exitCode}`, loadedAt: Date.now() }
  } catch (err) {
    log = { lines: [], error: String(err), loadedAt: Date.now() }
  }
  await update($, logAtom, () => log)
  return log
}

const paneOf = async ($: EngineInterface) =>
  (await $.ui.panes()).find(pane => pane.id === PANE)

// 다른 탭 뒤에 있어도 열려 있으면 graph 를 최신으로 유지한다.
const isOpen = async ($: EngineInterface) => (await paneOf($)) !== undefined

// header 의 상태 조각: branch, upstream 대비 ahead/behind, 변경 파일 수, 마지막 갱신 시각.
const statusPieces = (status: RepoStatus | undefined, loadedAt: number | undefined): Piece[] => {
  const pieces: Piece[] = []
  if (status) {
    pieces.push({ text: status.branch ?? '(detached)', color: 'cyan', bold: true })
    if (status.upstream) {
      if (status.ahead) pieces.push({ text: ` ↑${status.ahead}`, color: 'green' })
      if (status.behind) pieces.push({ text: ` ↓${status.behind}`, color: 'red' })
      if (!status.ahead && !status.behind) pieces.push({ text: ' =', dimColor: true })
    }
    pieces.push(status.changed
      ? { text: ` ● ${status.changed} changed`, color: 'yellow' }
      : { text: ' ✓ clean', color: 'green' })
  }
  if (loadedAt) pieces.push({ text: `${pieces.length ? ' · ' : ''}updated ${clockTime(loadedAt)}`, dimColor: true })
  return pieces
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-graph',
      description: 'Toggle the side pane showing the git log of the working directory as a graph',
    })
    // reload 로 session.start 가 다시 불려도 pane 이 열려 있을 때만 읽는다.
    if (await isOpen($).catch(() => false)) void refresh($)

    return next(e)
  })

  // /git-graph 는 pane 을 열고 닫는 toggle 이다. 세션 시작 시 자동으로 열지 않는다.
  // 다른 탭 뒤에 열려 있으면 닫지 않고 앞으로 가져온다.
  on('command.run', { command: 'git-graph' }, async $ => {
    const pane = await paneOf($)
    if (pane?.isShown) {
      await $.ui.close({ id: PANE })
      return { text: 'Git graph pane closed.' }
    }
    if (pane) {
      // 열린 id 를 다시 open 하면 제목만 바뀌고 탭은 그대로라, 닫았다 열어 맨 앞 탭으로 올린다.
      const log = await refresh($)
      await $.ui.close({ id: PANE })
      await $.ui.open({ id: PANE, title: TITLE })
      return { text: log.error ? `Git graph: ${log.error}` : 'Git graph pane brought to front.' }
    }
    await update($, offsetAtom, () => 0)
    const log = await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: log.error ? `Git graph: ${log.error}` : `Git graph pane opened (${log.lines.length} lines).` }
  })

  // graph 를 바꾸는 git 명령이 Bash 로 실행되고 pane 이 열려 있으면 다시 읽는다.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Bash' && changesGraph(e.command) && await isOpen($).catch(() => false)) void refresh($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const log = await read($, logAtom)
    const offset = await read($, offsetAtom)
    const columns = Math.max(20, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const room = Math.max(5, (e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 30) - 4) - 3)
    const maxOffset = Math.max(0, log.lines.length - room)
    const start = Math.min(offset, maxOffset)
    const shown = log.lines.slice(start, start + room)
    const now = Date.now()

    const scroll = (delta: number) => () =>
      void update($, offsetAtom, n => Math.min(maxOffset, Math.max(0, (n ?? 0) + delta)))

    const draw = (pieces: Piece[], key: string) =>
      pieces.map((p, i) => <Text key={`${key}${i}`} color={p.color} bold={p.bold} dimColor={p.dimColor}>{p.text}</Text>)

    const row = (line: GraphLine, i: number) => {
      const graph = [...line.graph].map((ch, col) =>
        ch === ' '
          ? <Text>{ch}</Text>
          : <Text color={LANE_COLORS[Math.floor(col / 2) % LANE_COLORS.length]} bold={ch === '*'}>{glyphOf(ch, line.isMerge)}</Text>,
      )
      if (!line.hash) return <Box key={`l${start + i}`} flexDirection="row">{graph}</Box>

      const refs = line.refs ? parseRefs(line.refs) : []
      const isHead = refs.some(ref => ref.kind === 'head')
      let left = columns - widthOf(line.graph) - line.hash.length - 1

      const refPieces: Piece[] = refs.length === 0 ? [] : [
        { text: '(', dimColor: true },
        ...refs.flatMap((ref, n): Piece[] => [
          ...(n > 0 ? [{ text: ', ', dimColor: true }] : []),
          { text: ref.name, color: REF_COLORS[ref.kind], bold: ref.kind === 'head' || ref.kind === 'local' },
        ]),
        { text: ') ', dimColor: true },
      ]
      const fitted = fitPieces(refPieces, Math.max(0, left))
      left -= fitted.reduce((sum, p) => sum + widthOf(p.text), 0)

      const meta = ` ${line.time ? relativeTime(line.time, now) : ''} ${line.author ?? ''}`.trimEnd()
      const subject = cutToWidth(line.subject ?? '', Math.max(0, left - (left > 40 ? widthOf(meta) : 0)))
      left -= widthOf(subject)
      const tail = left >= widthOf(meta) ? meta : ''

      return (
        <Box key={`l${start + i}`} flexDirection="row">
          {graph}
          <Text color="yellow" inverse={isHead}>{line.hash}</Text>
          <Text> </Text>
          {draw(fitted, 'r')}
          <Text bold={isHead}>{subject}</Text>
          {tail && <Text dimColor>{tail}</Text>}
        </Box>
      )
    }

    const status = statusPieces(log.status, log.loadedAt)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => void refresh($)} />
          <Button key="newer" label="Newer" hotkey="k" onPress={scroll(-room)} />
          <Button key="older" label="Older" hotkey="j" onPress={scroll(room)} />
          <Text dimColor>
            {log.lines.length > 0 ? `${start + 1}-${start + shown.length}/${log.lines.length}` : ''}
          </Text>
        </Box>
        {status.length > 0 && <Box flexDirection="row">{draw(fitPieces(status, columns), 's')}</Box>}
        {log.error && <Text color="red">{log.error}</Text>}
        {!log.error && log.lines.length === 0 && <Text dimColor>Loading git log…</Text>}
        {shown.map(row)}
      </Box>
    )
  })
}
