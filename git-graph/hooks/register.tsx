import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GraphLine, GraphLog } from '../types'
import { GIT_LOG_ARGV, cutToWidth, parseGraphLog, widthOf } from './parse'

const PANE = 'git-graph'
const TITLE = 'Git graph'
const logAtom = atom({ plugin: 'git-graph', key: 'log' } as const, { lines: [] } as GraphLog)
const offsetAtom = atom({ plugin: 'git-graph', key: 'offset' } as const, 0)

// graph 열마다 색을 돌려 branch 선을 구분한다.
const LANE_COLORS = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'] as const

async function refresh($: EngineInterface): Promise<GraphLog> {
  let log: GraphLog
  try {
    const { exitCode, stdout, stderr } = await $.process.run(GIT_LOG_ARGV, { timeoutMs: 10_000 })
    log = exitCode === 0
      ? { lines: parseGraphLog(stdout), loadedAt: Date.now() }
      : { lines: [], error: stderr.trim() || `git log exited with ${exitCode}`, loadedAt: Date.now() }
  } catch (err) {
    log = { lines: [], error: String(err), loadedAt: Date.now() }
  }
  await update($, logAtom, () => log)
  return log
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'git-graph',
      description: 'Toggle the side pane showing the git log of the working directory as a graph',
    })
    void refresh($)

    return next(e)
  })

  // /git-graph 는 pane 을 열고 닫는 toggle 이다. 세션 시작 시 자동으로 열지 않는다.
  on('command.run', { command: 'git-graph' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)) {
      await $.ui.close({ id: PANE })
      return { text: 'Git graph pane closed.' }
    }
    await update($, offsetAtom, () => 0)
    const log = await refresh($)
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: log.error ? `Git graph: ${log.error}` : `Git graph pane opened (${log.lines.length} lines).` }
  })

  // Bash 로 git 명령이 실행되면 끝난 뒤 graph 를 다시 읽는다.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === 'Bash' && /\bgit\b/.test(e.command)) void refresh($)

    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const log = await read($, logAtom)
    const offset = await read($, offsetAtom)
    const columns = Math.max(20, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const room = Math.max(5, (e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 30) - 4) - 2)
    const maxOffset = Math.max(0, log.lines.length - room)
    const start = Math.min(offset, maxOffset)
    const shown = log.lines.slice(start, start + room)

    const scroll = (delta: number) => () =>
      void update($, offsetAtom, n => Math.min(maxOffset, Math.max(0, (n ?? 0) + delta)))

    const row = (line: GraphLine, i: number) => {
      const graph = [...line.graph].map((ch, col) =>
        ch === ' '
          ? <Text>{ch}</Text>
          : <Text color={ch === '*' ? 'white' : LANE_COLORS[Math.floor(col / 2) % LANE_COLORS.length]} bold={ch === '*'}>{ch}</Text>,
      )
      if (!line.hash) return <Box key={`l${start + i}`} flexDirection="row">{graph}</Box>

      let left = columns - widthOf(line.graph) - line.hash.length - 1
      const refs = line.refs ? cutToWidth(`(${line.refs}) `, Math.max(0, left)) : ''
      left -= widthOf(refs)
      const meta = ` ${line.date} ${line.author}`
      const subject = cutToWidth(line.subject ?? '', Math.max(0, left - (left > 40 ? widthOf(meta) : 0)))
      left -= widthOf(subject)
      const tail = left >= widthOf(meta) ? meta : ''

      return (
        <Box key={`l${start + i}`} flexDirection="row">
          {graph}
          <Text color="yellow">{line.hash} </Text>
          {refs && <Text color="green" bold>{refs}</Text>}
          <Text>{subject}</Text>
          {tail && <Text dimColor>{tail}</Text>}
        </Box>
      )
    }

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
        {log.error && <Text color="red">{log.error}</Text>}
        {!log.error && log.lines.length === 0 && <Text dimColor>Loading git log…</Text>}
        {shown.map(row)}
      </Box>
    )
  })
}
