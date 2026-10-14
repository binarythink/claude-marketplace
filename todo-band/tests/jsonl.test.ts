import { describe, expect, mock, test } from 'claude-code/testing'

import { lookOf, parseTodoJsonl, summaryOf } from '../hooks/parse'

const SESSION = 'abc-123'
const BASE = '/private/tmp/claude-501'
const PAD = `${BASE}/-Users-me-proj/${SESSION}/scratchpad`
const JSONL = `${PAD}/TODO.jsonl`
const MD = `${PAD}/TODO.md`

const RUN = {
  command: 'todo',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })

const PLAN = [
  '{"id":"test","title":"통합 테스트","status":"todo","deps":["api","deploy"]}',
  '{"id":"schema","title":"DDL 작성","status":"done"}',
  '{"id":"api","title":"API 구현","status":"doing","deps":["schema"]}',
  '{"id":"deploy","title":"dev1 배포","status":"waiting","deps":["schema"],"note":"사용자가 ArgoCD sync"}',
  '{"id":"docs","title":"문서","status":"todo"}',
  '{"id":"batch","title":"배치 연동","status":"cancelled"}',
].join('\n')

describe('parseTodoJsonl', () => {
  test('orders items by deps, keeping file order between independent items', () => {
    const { rows, errors } = parseTodoJsonl(PLAN)
    expect(errors).toEqual([])
    expect(rows.map(row => row.id)).toEqual(['schema', 'api', 'deploy', 'test', 'docs', 'batch'])
  })

  test('derives blockedBy from deps that are not done', () => {
    const { rows } = parseTodoJsonl(PLAN)
    const row = (id: string) => rows.find(one => one.id === id)!
    expect(row('test').blockedBy).toEqual(['api', 'deploy'])
    expect(row('api').blockedBy).toEqual([])
    expect(row('deploy').note).toBe('사용자가 ArgoCD sync')
  })

  test('skips broken lines and duplicate ids, and flags unknown deps and cycles', () => {
    const { rows, errors } = parseTodoJsonl([
      '{"id":"a","title":"A","status":"todo","deps":["b"]}',
      '{"id":"b","title":"B","status":"todo","deps":["a"]}',
      'not json',
      '{"id":"a","title":"again","status":"todo"}',
      '{"id":"c","title":"C","status":"blocked"}',
      '{"id":"d","title":"D","status":"todo","deps":["ghost"]}',
      '',
    ].join('\n'))

    expect(rows.map(row => row.id)).toEqual(['d', 'a', 'b'])
    expect(rows.find(row => row.id === 'd')!.blockedBy).toEqual(['ghost'])
    expect(errors).toEqual([
      'line 3: not valid JSON',
      'line 4: duplicate id "a"',
      'line 5: c: "status" must be one of todo, doing, waiting, done, cancelled',
      'd: unknown dep "ghost"',
      'dependency cycle among: a, b',
    ])
  })
})

describe('lookOf / summaryOf', () => {
  test('tells agent work, user waits, ready and blocked items apart', () => {
    const { rows } = parseTodoJsonl(PLAN)
    const look = (id: string) => lookOf(rows.find(one => one.id === id)!)
    expect(look('api')).toMatchObject({ glyph: '▶', suffix: 'agent running' })
    expect(look('deploy')).toMatchObject({ glyph: '⏸', suffix: 'waiting on user' })
    expect(look('test')).toMatchObject({ glyph: '◌', dimColor: true, suffix: 'after api, deploy' })
    expect(look('docs')).toMatchObject({ glyph: '○' })
    expect(look('schema')).toMatchObject({ strikethrough: true })
    expect(look('batch')).toMatchObject({ glyph: '✗', strikethrough: true })
    expect(summaryOf(rows)).toBe('1/5 done · 1 running · 1 waiting on user · 1 ready')
  })
})

test('prefers TODO.jsonl over TODO.md and draws its rows', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'todo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: '/Users/me/proj' }))
  on('session.cwd', () => ({ value: '/Users/me/proj' }))
  on('fs.list', (_$, e) => ({ value: e.path === '/private/tmp' ? [dir('claude-501')] : [] }))
  on('fs.exists', (_$, e) => ({ value: e.path === PAD }))
  on('fs.stat', (_$, e) => {
    if (e.path !== JSONL && e.path !== MD) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 10, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', (_$, e) => ({ value: e.path === JSONL ? PLAN : '- [ ] markdown\n' }))

  await $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(await $.command.run(RUN)).toMatchObject({ text: `TODO pane opened: ${JSONL}` })

  const ui = await $.ui.mount({
    plugin: 'todo-band',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'TODO' },
    requestId: 'todo',
  } as never)

  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  expect(texts).toEqual([
    'auto ○ · 1/5 done · 1 running · 1 waiting on user · 1 ready',
    '✓ DDL 작성',
    '▶ API 구현  (agent running)',
    '⏸ dev1 배포  (waiting on user)',
    '    사용자가 ArgoCD sync',
    '◌ 통합 테스트  (after api, deploy)',
    '○ 문서',
    '✗ 배치 연동  (cancelled)',
  ])
})
