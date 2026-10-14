import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/Users/me/repo'
const PROJECTS = '/Users/me/.claude/projects/-Users-me-repo'
const TMP = '/private/tmp/claude-501'
const PAD = `${TMP}/-Users-me-repo/s-now/scratchpad`

const RUN = {
  command: 'outputs',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

const entry = (name: string, kind: 'file' | 'dir' = 'file') =>
  ({ name, kind, size: 10, mtimeMs: 1, isLink: false })

const transcript = (lines: object[]) => lines.map(one => JSON.stringify(one)).join('\n')

const NOW = transcript([
  { type: 'user', timestamp: '2026-10-15T01:00:00Z', cwd: ROOT, gitBranch: 'feat/now', message: { content: '작업 https://vroong-jira.atlassian.net/browse/ABC-1' } },
  { type: 'assistant', timestamp: '2026-10-15T01:05:00Z', cwd: ROOT, message: { content: [
    { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: `${ROOT}/mod/a.ts`, content: '' } },
    { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: `${ROOT}/gone.ts`, content: '' } },
    { type: 'tool_use', id: 't3', name: 'Write', input: { file_path: `${PAD}/notes.md`, content: '' } },
    { type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'gh pr create --fill' } },
  ] } },
  { type: 'user', timestamp: '2026-10-15T01:06:00Z', cwd: ROOT, message: { content: [
    { type: 'tool_result', tool_use_id: 't4', content: 'https://github.com/o/r/pull/4\n' },
  ] } },
  { type: 'custom-title', customTitle: 'now work' },
])

function setup(on: On, tabs: string[]) {
  mock.env(on, { HOME: '/Users/me' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'outputs' } }))
  on('ui.open', (_$, e) => {
    if (!tabs.includes(e.id)) tabs.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    tabs.splice(tabs.indexOf(e.id) >>> 0, 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: tabs.map((id, i) =>
      ({ id, title: id, isShown: i === tabs.length - 1, isFocused: false, isPlaced: true })) as never,
  }))
  on('session.id', () => ({ value: 's-now' }))
  on('session.root', () => ({ value: ROOT }))
  on('session.cwd', () => ({ value: ROOT }))
}

test('toggles a pane grouping only the current session’s artifacts by source', async ($, on) => {
  const clock = mock.clock(on)
  const tabs: string[] = []
  setup(on, tabs)
  // 같은 폴더의 다른 세션 transcript 는 읽지 않는다.
  const reads: string[] = []
  on('fs.read', (_$, e) => {
    reads.push(e.path)
    return { value: e.path === `${PROJECTS}/s-now.jsonl` ? NOW : '' }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: `worktree ${ROOT}\nHEAD abc\n`, stderr: '' } as never }))
  on('fs.list', (_$, e) => {
    const lists: Record<string, ReturnType<typeof entry>[]> = {
      '/private/tmp': [entry('claude-501', 'dir')],
      '/tmp': [entry('claude-501', 'dir')],
      [PROJECTS]: [entry('s-old.jsonl'), entry('s-now.jsonl')],
      [PAD]: [entry('notes.md'), entry('shot', 'dir')],
      [`${PAD}/shot`]: [entry('p1.png')],
    }
    return { value: lists[e.path] ?? [] }
  })
  on('fs.stat', (_$, e) => {
    if (e.path === `${PROJECTS}/s-now.jsonl`) {
      return { value: { kind: 'file' as const, size: NOW.length, mtimeMs: 1, isLink: false } }
    }
    // macOS 의 /tmp 는 /private/tmp 를 가리킨다. 두 번 세면 Scratch 가 중복된다.
    return { value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false, realPath: e.path.replace(/^\/tmp\//, '/private/tmp/') } as never }
  })
  on('fs.exists', (_$, e) => ({
    value: e.path === `${ROOT}/mod/a.ts` || e.path === PAD || e.path === PAD.replace('/private/tmp/', '/tmp/'),
  }))

  const copied: string[] = []
  const toasts: string[] = []
  on('ui.copy', (_$, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } as never }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? e))
    return { value: undefined as never }
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await clock.settle()

  expect(tabs).toEqual([])
  expect(await $.command.run(RUN)).toMatchObject({ text: 'Session outputs pane opened: 7 artifacts.' })
  expect(tabs).toEqual(['session-outputs'])
  expect(reads).toEqual([`${PROJECTS}/s-now.jsonl`])

  const ui = await $.ui.mount({
    plugin: 'session-outputs',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'Session outputs' },
    requestId: 'session-outputs',
  } as never)

  const texts = await ui.findAll({ type: 'Text' })
  const drawn = texts.map(one => one.text).join('\n')
  expect(drawn).toContain('▸ input (1)')
  expect(drawn).toContain('▸ output (6)')
  expect(drawn.indexOf('▸ output')).toBeLessThan(drawn.indexOf('▸ input'))
  expect(drawn).not.toContain('▸ PR')
  expect(drawn).toContain('now work')

  // 행은 type, name, path 순이다. 같은 그룹 안에서 파일과 링크가 처음 나온 순서대로 섞인다.
  const rows = texts
    .filter(one => one.props.wrap === 'truncate-end' && /^(› |  )\S/.test(one.text))
    .map(one => one.text)
  // 파일의 path 칸은 폴더만 보인다(이름은 name 칸에 있다).
  const expected: [string, string, string?][] = [
    ['File', 'a.ts', 'mod'],
    ['File', 'gone.ts (deleted)', '.'],
    ['PR', 'o/r#4', 'https://github.com/o/r/pull/4'],
    ['Branch', 'feat/now'],
    ['Scratch', 'notes.md', PAD],
    ['Scratch', 'p1.png', `${PAD}/shot`],
    ['Jira', 'ABC-1', 'https://vroong-jira.atlassian.net/browse/ABC-1'],
  ]
  expect(rows).toHaveLength(expected.length)
  expected.forEach(([type, name, path], i) => {
    expect(rows[i]!.slice(2)).toStartWith(`${type.padEnd('Scratch'.length)}  ${name}`)
    // 테스트 렌더러는 Link 의 text 를 href 와 글자를 이어 붙여 만든다.
    if (path) expect(rows[i]).toContain(`${name}  `)
    expect(rows[i]).toEndWith(path ?? name)
  })
  // path 칸은 흐리게 그린다. 링크만 Link 이고, 파일은 Link 를 쓰지 않는다.
  expect(texts.filter(one => one.props.dimColor).map(one => one.text)).toEqual(expect.arrayContaining([
    '  mod', '  .', `  ${PAD}`, `  ${PAD}/shot`,
  ]))
  expect((await ui.findAll({ type: 'Link' })).map(one => one.props.href)).toEqual([
    'https://github.com/o/r/pull/4',
    'https://vroong-jira.atlassian.net/browse/ABC-1',
  ])

  // j/k 로 한 item 씩 움직이고 c 는 이름, p 는 경로(링크는 URL, 파일은 절대 경로)를 복사한다.
  const selectedText = async () =>
    (await ui.findAll({ type: 'Text' })).find(one => one.props.inverse)?.text

  expect(await selectedText()).toEndWith('a.ts')
  await ui.press({ key: 'copy-name' })
  await ui.press({ key: 'copy-path' })
  expect(copied.slice(-2)).toEqual(['a.ts', `${ROOT}/mod/a.ts`])
  expect(toasts.at(-1)).toContain(`Copied path: ${ROOT}/mod/a.ts`)

  await ui.press({ key: 'prev' })
  expect(await selectedText()).toEndWith('a.ts')

  // a.ts → gone.ts → PR
  for (let i = 0; i < 2; i++) await ui.press({ key: 'next' })
  expect(await selectedText()).toEndWith('o/r#4')
  await ui.press({ key: 'copy-path' })
  expect(copied.at(-1)).toBe('https://github.com/o/r/pull/4')

  // 끝에서 더 내려가도 마지막 item 에 머문다. output 그룹 다음이 input 그룹이다.
  for (let i = 0; i < 10; i++) await ui.press({ key: 'next' })
  expect(await selectedText()).toEndWith('ABC-1')
  await ui.press({ key: 'copy-path' })
  expect(copied.at(-1)).toBe('https://vroong-jira.atlassian.net/browse/ABC-1')

  // 다시 그리기 전에 연달아 눌러도 누른 만큼 움직인다.
  await Promise.all([1, 2, 3].map(() => ui.press({ key: 'prev' })))
  expect(await selectedText()).toEndWith('feat/now')

  // branch 는 URL 이 없으면 이름을 경로로 복사한다.
  await ui.press({ key: 'copy-path' })
  expect(copied.at(-1)).toBe('feat/now')

  // scratchpad 파일은 절대 경로를 복사한다.
  await ui.press({ key: 'next' })
  expect(await selectedText()).toEndWith('notes.md')
  await ui.press({ key: 'copy-path' })
  expect(copied.at(-1)).toBe(`${PAD}/notes.md`)

  expect(await $.command.run(RUN)).toMatchObject({ text: 'Session outputs pane closed.' })
  expect(tabs).toEqual([])
})

test('reads a transcript over 4 MiB in line-aligned pieces', async ($, on) => {
  setup(on, [])
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', (_$, e) => {
    if (e.path !== `${PROJECTS}/s-now.jsonl`) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 5 * 1024 * 1024, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', () => {
    throw new Error('over the 4194304-byte limit')
  })

  // 첫 줄은 한글을 포함해 바이트 수가 글자 수와 다르다. 두 번째 줄은 첫 조각 끝에서 잘린다.
  const first = `${JSON.stringify({ type: 'user', timestamp: '2026-10-15T00:00:00Z', message: { content: '첫 요청 https://vroong-jira.atlassian.net/browse/ABC-1' } })}\n`
  const second = `${JSON.stringify({ type: 'user', timestamp: '2026-10-15T00:01:00Z', message: { content: 'https://github.com/o/r/pull/5' } })}\n`
  const firstBytes = new TextEncoder().encode(first).length
  const offsets: string[] = []
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'git') return { value: { exitCode: 0, stdout: `worktree ${ROOT}\n`, stderr: '' } as never }
    offsets.push(e.argv[2]!)
    return {
      value: (e.argv[2] === '+1'
        ? { exitCode: 0, stdout: first + second.slice(0, 20), stderr: '', isStdoutTruncated: true, isStderrTruncated: false }
        : { exitCode: 0, stdout: second, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never,
    }
  })

  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(await $.command.run(RUN)).toMatchObject({ text: 'Session outputs pane opened: 2 artifacts.' })
  expect(offsets).toEqual(['+1', `+${firstBytes + 1}`])
})
