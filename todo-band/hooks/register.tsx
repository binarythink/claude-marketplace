import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TodoFile } from '../types'
import { lookOf, parseTodoJsonl, summaryOf } from './parse'

const todo = atom({ plugin: 'todo-band', key: 'todo' } as const, null)

const PANE = 'todo'
const PANE_TITLE = 'TODO'
// 앞의 것을 우선한다. TODO.jsonl 이 있으면 TODO.md 는 보지 않는다.
const FILE_NAMES = ['TODO.jsonl', 'TODO.md']
const POLL_MS = 2000
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

async function refresh($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    const id = await $.session.id()
    if (id !== sessionId) {
      sessionId = id
      scratchpad = undefined
      loadedPath = ''
      mtimeMs = -1
    }
    scratchpad ??= await findScratchpad($, sessionId)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: "Toggle the pane showing the session scratchpad's TODO.jsonl (or TODO.md)",
    })
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

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const file = await read($, todo)

    if (file?.format === 'jsonl') {
      return (
        <Box flexDirection="column">
          <Text bold>{file.rows.length === 0 ? 'No items in TODO.jsonl.' : summaryOf(file.rows)}</Text>
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
