import { describe, expect, test } from 'claude-code/testing'

import { cutToWidth, parseGraphLog, widthOf } from '../hooks/parse'

const S = '\x1f'
const LOG = [
  `*   ${S}aaaaaaa${S}HEAD -> main, origin/main${S}Merge pull request #2${S}Kim${S}2026-10-10`,
  '|\\  ',
  `| * ${S}bbbbbbb${S}${S}영업기준표 검증 수정${S}Lee${S}2026-10-09`,
  '|/  ',
  `* ${S}ccccccc${S}tag: v1.0${S}initial${S}Kim${S}2026-10-01`,
].join('\n')

const gitLog = (exitCode: number, stdout: string, stderr = '') =>
  ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

const START = { cwd: '/repo', surface: null, isInteractive: true } as const

const RUN = {
  command: 'git-graph',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

const PANE = {
  title: 'Git graph',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

describe('parse', () => {
  test('splits commits and connector lines', async () => {
    const lines = parseGraphLog(LOG)
    expect(lines).toHaveLength(5)
    expect(lines[0]).toMatchObject({ graph: '*   ', hash: 'aaaaaaa', refs: 'HEAD -> main, origin/main' })
    expect(lines[1]).toEqual({ graph: '|\\' })
    expect(lines[2]?.refs).toBeUndefined()
  })

  test('counts hangul as two cells and cuts to width', async () => {
    expect(widthOf('a한')).toBe(3)
    expect(cutToWidth('영업기준표', 5)).toBe('영업…')
    expect(cutToWidth('abc', 5)).toBe('abc')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`pane on ${surface}`, () => {
    test('draws commits from git log', async ($, on) => {
      on('session.start', async ($, e) => ({ cwd: e.cwd }))
      on('command.register', async ($, e) => ({ value: { command: e.name } }))
      on('ui.open', async () => ({ value: { isPlaced: true as const } }))
      on('process.run', async () => gitLog(0, LOG))
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', requestId: 'git-graph', props: PANE })

      expect(await ui.find({ text: 'aaaaaaa' })).toBeDefined()
      expect(await ui.find({ text: '(HEAD -> main, origin/main) ' })).toBeDefined()
      expect(await ui.find({ text: '1-5/5' })).toBeDefined()
    })

    test('shows the error outside a git repository', async ($, on) => {
      on('session.start', async ($, e) => ({ cwd: e.cwd }))
      on('command.register', async ($, e) => ({ value: { command: e.name } }))
      on('ui.open', async () => ({ value: { isPlaced: true as const } }))
      on('process.run', async () => gitLog(128, '', 'fatal: not a git repository'))
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', requestId: 'git-graph', props: PANE })

      expect(await ui.find({ text: 'fatal: not a git repository' })).toBeDefined()
    })
  })
}

describe('toggle', () => {
  test('stays closed at start; /git-graph opens then closes the pane', async ($, on) => {
    const shown = new Set<string>()
    on('session.start', async ($, e) => ({ cwd: e.cwd }))
    on('command.register', async ($, e) => ({ value: { command: e.name } }))
    on('process.run', async () => gitLog(0, LOG))
    on('ui.open', async ($, e) => {
      shown.add(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', async ($, e) => {
      shown.delete(e.id)
      return { value: undefined }
    })
    on('ui.panes', async () => ({
      value: [...shown].map(id => ({ id, title: 'Git graph', isShown: true, isFocused: false, isPlaced: true })) as never,
    }))
    await $.session.start(START)
    expect(shown.has('git-graph')).toBe(false)

    expect(await $.command.run(RUN)).toMatchObject({ text: 'Git graph pane opened (5 lines).' })
    expect(shown.has('git-graph')).toBe(true)

    expect(await $.command.run(RUN)).toMatchObject({ text: 'Git graph pane closed.' })
    expect(shown.has('git-graph')).toBe(false)
  })
})
