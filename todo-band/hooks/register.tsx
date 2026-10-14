import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TodoFile } from '../types'
import { autoTodoContext, parseAutoTodoArgs } from './auto'
import { lookOf, parseTodoJsonl, summaryOf } from './parse'

const todo = atom({ plugin: 'todo-band', key: 'todo' } as const, null)
// 세션 한정 on/off. null 은 아직 정하지 않음 — session.start 가 userConfig 기본값으로 채운다.
const autoTodo = atom({ plugin: 'todo-band', key: 'autoTodo' } as const, null)

const PANE = 'todo'
const PANE_TITLE = 'TODO'
// 앞의 것을 우선한다. TODO.jsonl 이 있으면 TODO.md 는 보지 않는다.
const FILE_NAMES = ['TODO.jsonl', 'TODO.md']
const POLL_MS = 2000
const JSONL = 'TODO.jsonl'
// 이 도구를 쓴 턴은 작업을 한 턴으로 보고, TODO.jsonl 이 그대로면 다음 프롬프트에 리마인더를 붙인다.
const WORK_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'])
const TMP_ROOTS = ['/private/tmp', '/tmp']

// Claude Code keeps a session's scratchpad at
// <tmp>/claude-<uid>/<cwd slug>/<session id>/scratchpad
const slugOf = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-')

async function findScratchpad($: EngineInterface, sessionId: string) {
  const custom = await $.env.get('CLAUDE_CODE_TMPDIR')
  const roots = custom ? [custom, ...TMP_ROOTS] : TMP_ROOTS
  const slugs = [...new Set([slugOf(await $.session.root()), slugOf(await $.session.cwd())])]

  for (const root of roots) {
    const entries = await $.fs.list(root).catch(() => [])
    const owners = entries.filter(one => one.kind === 'dir' && one.name.startsWith('claude-'))
    for (const owner of owners) {
      const base = `${root}/${owner.name}`
      for (const slug of slugs) {
        const dir = `${base}/${slug}/${sessionId}/scratchpad`
        if (await $.fs.exists(dir)) return dir
      }
      // The slug rule may differ; fall back to scanning every project folder.
      const projects = await $.fs.list(base).catch(() => [])
      for (const project of projects) {
        const dir = `${base}/${project.name}/${sessionId}/scratchpad`
        if (project.kind === 'dir' && (await $.fs.exists(dir))) return dir
      }
    }
  }

  return undefined
}

// Reset on every reload, which only means one re-read of the TODO file.
let sessionId = ''
let scratchpad: string | undefined
let loadedPath = ''
let mtimeMs = -1
let isPolling = false
// auto-todo 의 턴 추적. reload 로 초기화돼도 리마인더 한 번을 놓칠 뿐이다.
let isOffNoticePending = false
let isNudgePending = false
let turnId = ''
let turnStartMtimeMs = -1
let didWork = false

async function locateScratchpad($: EngineInterface) {
  const id = await $.session.id()
  if (id !== sessionId) {
    sessionId = id
    scratchpad = undefined
    loadedPath = ''
    mtimeMs = -1
  }
  scratchpad ??= await findScratchpad($, sessionId)
  return scratchpad
}

// TODO.jsonl 의 mtime. 파일이 없으면 -1.
async function jsonlMtime($: EngineInterface) {
  const dir = await locateScratchpad($)
  if (dir === undefined) return -1
  const stat = await $.fs.stat(`${dir}/${JSONL}`).catch(() => undefined)
  return stat?.kind === 'file' ? stat.mtimeMs : -1
}

async function refresh($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    await locateScratchpad($)
    if (scratchpad === undefined) return

    let found: { path: string; mtimeMs: number } | undefined
    for (const name of FILE_NAMES) {
      const path = `${scratchpad}/${name}`
      const stat = await $.fs.stat(path).catch(() => undefined)
      if (stat?.kind === 'file') {
        found = { path, mtimeMs: stat.mtimeMs }
        break
      }
    }
    if (found === undefined) {
      if (mtimeMs !== -1) {
        loadedPath = ''
        mtimeMs = -1
        await update($, todo, () => null)
      }
      return
    }
    if (found.path === loadedPath && found.mtimeMs === mtimeMs) return

    const { path } = found
    const text = await $.fs.read(path)
    loadedPath = path
    mtimeMs = found.mtimeMs
    const file: TodoFile = path.endsWith('.jsonl')
      ? { format: 'jsonl', path, ...parseTodoJsonl(text) }
      : { format: 'md', path, text }
    await update($, todo, () => file)
  } finally {
    isPolling = false
  }
}

export const register: Register = (on, options) => {
  const autoTodoDefault = options.autoTodoDefault === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: "Toggle the pane showing the session scratchpad's TODO.jsonl (or TODO.md)",
    })
    await $.command.register({
      name: 'auto-todo',
      description: 'Turn on or off having Claude keep TODO.jsonl up to date on every request (this session only)',
      argumentHint: '[on|off]',
    })
    // reload 때는 $.state 가 남아 있으므로 세션에서 처음 시작할 때만 기본값을 넣는다.
    if ((await read($, autoTodo)) === null) await update($, autoTodo, () => autoTodoDefault)
    await refresh($).catch(() => undefined)
    $.clock.every(POLL_MS, () => {
      void refresh($).catch(() => undefined)
    })

    return next(e)
  })

  // /todo 는 pane 을 열고 닫는 toggle 이다. TODO 파일이 생겨도 자동으로 열지 않는다.
  // 다른 탭 뒤에 열려 있으면 닫지 않고 앞으로 가져온다.
  on('command.run', { command: 'todo' }, async $ => {
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (pane?.isShown) {
      await $.ui.close({ id: PANE })
      return { text: 'TODO pane closed.' }
    }
    if (pane) {
      // 열린 id 를 다시 open 하면 제목만 바뀌고 탭은 그대로라, 닫았다 열어 맨 앞 탭으로 올린다.
      await $.ui.close({ id: PANE })
      await $.ui.open({ id: PANE, title: PANE_TITLE })
      return { text: 'TODO pane brought to front.' }
    }
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    const file = await read($, todo)

    return { text: file ? `TODO pane opened: ${file.path}` : 'TODO pane opened (no TODO.jsonl or TODO.md in the scratchpad yet).' }
  })

  on('command.run', { command: 'auto-todo' }, async ($, e) => {
    const isOn = (await read($, autoTodo)) === true
    const wanted = parseAutoTodoArgs(e.args, isOn)
    if (wanted === undefined) return { text: `Usage: /auto-todo [on|off] (now ${isOn ? 'on' : 'off'})` }
    if (wanted === isOn) return { text: `auto-todo is already ${isOn ? 'on' : 'off'}.` }
    await update($, autoTodo, () => wanted)
    // 켤 때는 지난 off 안내를, 끌 때는 남은 리마인더를 버린다.
    isOffNoticePending = !wanted
    isNudgePending = false
    turnId = ''
    return {
      text: wanted
        ? 'auto-todo on: Claude will keep TODO.jsonl up to date on every request in this session.'
        : 'auto-todo off: Claude stops updating TODO.jsonl on its own. The file is kept.',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    // 슬래시 명령과 사용자가 직접 치지 않은 프롬프트(알림 등)에는 붙이지 않는다.
    if (e.command || e.isMeta) return next(e)
    // 상태를 못 읽어도 프롬프트는 막지 않는다.
    const isOn = await read($, autoTodo).then(value => value === true).catch(() => false)
    const text = autoTodoContext({ isOn, isOffNoticePending, isNudgePending })
    isOffNoticePending = false
    isNudgePending = false
    if (text === undefined) return next(e)
    return next({ ...e, context: [...(e.context ?? []), text] })
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, autoTodo)) === true) {
      turnId = e.turnId
      didWork = false
      turnStartMtimeMs = await jsonlMtime($).catch(() => -1)
    }
    return next(e)
  })

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined && WORK_TOOLS.has(e.tool)) didWork = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.turnId === turnId) {
      turnId = ''
      if (e.reason === 'answer' && didWork && (await read($, autoTodo)) === true) {
        isNudgePending = (await jsonlMtime($).catch(() => -1)) === turnStartMtimeMs
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const file = await read($, todo)
    const auto = (await read($, autoTodo)) === true ? 'auto ●' : 'auto ○'

    if (file?.format === 'jsonl') {
      return (
        <Box flexDirection="column">
          <Text bold>{`${auto} · ${file.rows.length === 0 ? 'No items in TODO.jsonl.' : summaryOf(file.rows)}`}</Text>
          {file.rows.map(row => {
            const look = lookOf(row)
            return (
              <Box flexDirection="column">
                <Text
                  color={look.color}
                  bold={look.bold}
                  dimColor={look.dimColor}
                  strikethrough={look.strikethrough}
                  wrap="truncate-end"
                >
                  {`${look.glyph} ${row.title}${look.suffix ? `  (${look.suffix})` : ''}`}
                </Text>
                {row.note && <Text dimColor wrap="truncate-end">{`    ${row.note}`}</Text>}
              </Box>
            )
          })}
          {file.errors.map(error => (
            <Text color="error" wrap="truncate-end">{`! ${error}`}</Text>
          ))}
        </Box>
      )
    }

    const lines = file?.text.split('\n').filter(line => line.trim() !== '') ?? []
    return (
      <Box flexDirection="column">
        <Text dimColor>{auto}</Text>
        {lines.length === 0 && <Text dimColor>No TODO.jsonl or TODO.md in this session's scratchpad.</Text>}
        {lines.map(line => {
          const isDone = /^\s*[-*]\s+\[[xX]\]/.test(line)
          const isHeading = /^\s*#/.test(line)
          return (
            <Text dimColor={isDone} strikethrough={isDone} bold={isHeading} wrap="truncate-end">
              {line}
            </Text>
          )
        })}
      </Box>
    )
  })
}
