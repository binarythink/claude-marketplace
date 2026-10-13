import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TodoFile } from '../types'

const todo = atom({ plugin: 'todo-band', key: 'todo' } as const, null)

const PANE = 'todo'
const PANE_TITLE = 'TODO.md'
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

// Reset on every reload, which only means one re-read of TODO.md.
let sessionId = ''
let scratchpad: string | undefined
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
      mtimeMs = -1
    }
    scratchpad ??= await findScratchpad($, sessionId)
    if (scratchpad === undefined) return

    const path = `${scratchpad}/TODO.md`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat === undefined || stat.kind !== 'file') {
      if (mtimeMs !== -1) {
        mtimeMs = -1
        await update($, todo, () => null)
      }
      return
    }
    if (stat.mtimeMs === mtimeMs) return

    const text = await $.fs.read(path)
    mtimeMs = stat.mtimeMs
    const file: TodoFile = { path, text }
    await update($, todo, () => file)
  } finally {
    isPolling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todo',
      description: "Toggle the pane showing the session scratchpad's TODO.md",
    })
    await refresh($).catch(() => undefined)
    $.clock.every(POLL_MS, () => {
      void refresh($).catch(() => undefined)
    })

    return next(e)
  })

  // /todo 는 pane 을 열고 닫는 toggle 이다. TODO.md 가 생겨도 자동으로 열지 않는다.
  on('command.run', { command: 'todo' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)) {
      await $.ui.close({ id: PANE })
      return { text: 'TODO pane closed.' }
    }
    await refresh($).catch(() => undefined)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    const file = await read($, todo)

    return { text: file ? `TODO pane opened: ${file.path}` : 'TODO pane opened (no TODO.md in the scratchpad yet).' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const file = await read($, todo)
    const lines = file?.text.split('\n').filter(line => line.trim() !== '') ?? []

    return (
      <Box flexDirection="column">
        {lines.length === 0 && <Text dimColor>No TODO.md in this session's scratchpad.</Text>}
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
