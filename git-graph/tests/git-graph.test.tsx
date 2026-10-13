import { describe, expect, mock, test } from 'claude-code/testing'

import {
  changesGraph, cutToWidth, fitPieces, glyphOf, parseGraphLog, parseRefs, parseStatus, relativeTime, widthOf,
} from '../hooks/parse'

const S = '\x1f'
const LOG = [
  `*   ${S}aaaaaaa${S}ccccccc bbbbbbb${S}HEAD -> refs/heads/main, refs/remotes/origin/main${S}Merge pull request #2${S}Kim${S}1791600000`,
  '|\\  ',
  `| * ${S}bbbbbbb${S}ccccccc${S}${S}영업기준표 검증 수정${S}Lee${S}1791500000`,
  '|/  ',
  `* ${S}ccccccc${S}${S}tag: refs/tags/v1.0${S}initial${S}Kim${S}1790800000`,
].join('\n')

const STATUS = [
  '# branch.oid aaaaaaa',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
  '1 .M N... 100644 100644 100644 0 0 a.ts',
  '? new.txt',
].join('\n')

const gitLog = (exitCode: number, stdout: string, stderr = '') =>
  ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })

// git log 과 git status 를 argv 로 구분해 응답한다.
const git = (exitCode: number, stdout: string, stderr = '') =>
  async (_$: unknown, e: { argv: readonly string[] }) =>
    e.argv[1] === 'status' ? gitLog(0, STATUS) : gitLog(exitCode, stdout, stderr)

const shownPanes = (ids: Iterable<string>) =>
  async () => ({
    value: [...ids].map(id => ({ id, title: 'Git graph', isShown: true, isFocused: false, isPlaced: true })) as never,
  })

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
    expect(lines[0]).toMatchObject({ graph: '*   ', hash: 'aaaaaaa', time: 1791600000, isMerge: true })
    expect(lines[1]).toEqual({ graph: '|\\' })
    expect(lines[2]?.refs).toBeUndefined()
    expect(lines[2]?.isMerge).toBe(false)
  })

  test('classifies refs by kind', async () => {
    expect(parseRefs('HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1.0, refs/heads/feat/x, refs/stash'))
      .toEqual([
        { name: 'HEAD -> main', kind: 'head' },
        { name: 'origin/main', kind: 'remote' },
        { name: 'tag: v1.0', kind: 'tag' },
        { name: 'feat/x', kind: 'local' },
        { name: 'stash', kind: 'other' },
      ])
    expect(parseRefs('HEAD')).toEqual([{ name: 'HEAD', kind: 'head' }])
  })

  test('reads branch, ahead/behind and changed files from status', async () => {
    expect(parseStatus(STATUS)).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, changed: 2 })
    expect(parseStatus('# branch.oid x\n# branch.head (detached)\n')).toEqual({ ahead: 0, behind: 0, changed: 0 })
  })

  test('refreshes only for git commands that change the graph', async () => {
    expect(changesGraph('git commit -m "x"')).toBe(true)
    expect(changesGraph('git -C /repo checkout main')).toBe(true)
    expect(changesGraph('cd a && git pull --rebase')).toBe(true)
    expect(changesGraph('git status')).toBe(false)
    expect(changesGraph('git --no-pager log -5')).toBe(false)
    expect(changesGraph('git diff HEAD~1')).toBe(false)
    expect(changesGraph('ls digit')).toBe(false)
  })

  test('maps graph characters to box-drawing glyphs', async () => {
    expect([...'*|/\\- '].map(ch => glyphOf(ch)).join('')).toBe('●│╱╲─ ')
    expect(glyphOf('*', true)).toBe('◉')
  })

  test('shortens times relative to now', async () => {
    const now = 1_800_000_000_000
    expect(relativeTime(now / 1000 - 30, now)).toBe('just now')
    expect(relativeTime(now / 1000 - 3 * 3600, now)).toBe('3h ago')
    expect(relativeTime(now / 1000 - 10 * 86400, now)).toBe('1w ago')
  })

  test('fits colored pieces to width', async () => {
    expect(fitPieces([{ text: '(' }, { text: 'main' }, { text: ') ' }], 4)).toEqual([{ text: '(' }, { text: 'ma…' }])
    expect(fitPieces([{ text: 'ab' }, { text: 'cd' }], 4)).toEqual([{ text: 'ab' }, { text: 'cd' }])
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
      on('ui.panes', shownPanes(['git-graph']))
      on('process.run', git(0, LOG))
      await $.session.start(START)
      const ui = await $.ui.mount({ plugin: 'git-graph', surface, component: 'Pane', requestId: 'git-graph', props: PANE })

      expect(await ui.find({ text: 'aaaaaaa' })).toBeDefined()
      expect(await ui.find({ text: 'HEAD -> main' })).toBeDefined()
      expect(await ui.find({ text: 'origin/main' })).toBeDefined()
      expect(await ui.find({ text: '◉' })).toBeDefined()
      expect(await ui.find({ text: 'main' })).toBeDefined()
      expect(await ui.find({ text: ' ↑2' })).toBeDefined()
      expect(await ui.find({ text: ' ↓1' })).toBeDefined()
      expect(await ui.find({ text: ' ● 2 changed' })).toBeDefined()
      expect(await ui.find({ text: '1-5/5' })).toBeDefined()
    })

    test('shows the error outside a git repository', async ($, on) => {
      on('session.start', async ($, e) => ({ cwd: e.cwd }))
      on('command.register', async ($, e) => ({ value: { command: e.name } }))
      on('ui.open', async () => ({ value: { isPlaced: true as const } }))
      on('ui.panes', shownPanes(['git-graph']))
      on('process.run', git(128, '', 'fatal: not a git repository'))
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
    on('process.run', git(0, LOG))
    on('ui.open', async ($, e) => {
      shown.add(e.id)
      return { value: { isPlaced: true as const } }
    })
    on('ui.close', async ($, e) => {
      shown.delete(e.id)
      return { value: undefined }
    })
    on('ui.panes', async () => shownPanes(shown)())
    await $.session.start(START)
    expect(shown.has('git-graph')).toBe(false)

    expect(await $.command.run(RUN)).toMatchObject({ text: 'Git graph pane opened (5 lines).' })
    expect(shown.has('git-graph')).toBe(true)

    expect(await $.command.run(RUN)).toMatchObject({ text: 'Git graph pane closed.' })
    expect(shown.has('git-graph')).toBe(false)
  })
})

describe('refresh after Bash', () => {
  for (const [label, open, command, runs] of [
    ['re-reads after a commit while the pane is open', true, 'git commit -m x', 2],
    ['skips read-only git commands', true, 'git status', 0],
    ['skips while the pane is closed', false, 'git commit -m x', 0],
  ] as const) {
    test(label, async ($, on) => {
      const argvs: string[] = []
      const clock = mock.clock(on)
      on('session.start', async ($, e) => ({ cwd: e.cwd }))
      on('command.register', async ($, e) => ({ value: { command: e.name } }))
      on('ui.panes', shownPanes(open ? ['git-graph'] : []))
      on('process.run', async ($, e) => {
        argvs.push(e.argv[1] ?? '')
        return git(0, LOG)($, e)
      })
      on('tool.call', async () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
      await $.session.start(START)
      argvs.length = 0

      await $.tool.call({ tool: 'Bash', command } as never)
      await clock.settle()
      expect(argvs).toHaveLength(runs)
    })
  }
})
