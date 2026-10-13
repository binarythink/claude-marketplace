import { expect, mock, test } from 'claude-code/testing'

const SESSION = 'abc-123'
const BASE = '/private/tmp/claude-501'
const PAD = `${BASE}/-Users-me-proj/${SESSION}/scratchpad`
const TODO = `${PAD}/TODO.md`

const RUN = {
  command: 'todo',
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })

test('draws the scratchpad TODO.md in a pane', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, {})
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'todo' } }))
  // 탭은 연 순서대로 쌓이고 마지막에 새로 연 pane 이 앞에 보인다. 열린 id 의 open 은 탭을 바꾸지 않는다.
  const tabs: string[] = []
  const shown = { has: (id: string) => tabs.includes(id) }
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
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: '/Users/me/proj' }))
  on('session.cwd', () => ({ value: '/Users/me/proj' }))
  on('fs.list', (_$, e) => ({ value: e.path === '/private/tmp' ? [dir('claude-501')] : [] }))
  on('fs.exists', (_$, e) => ({ value: e.path === PAD }))
  on('fs.stat', (_$, e) => {
    if (e.path !== TODO) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 10, mtimeMs: 1, isLink: false } }
  })
  on('fs.read', () => ({ value: '# Plan\n- [x] write mod\n- [ ] ship it\n' }))

  await $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
  await clock.settle()

  // TODO.md 가 있어도 자동으로 열지 않고, /todo 로 열고 닫는다.
  expect(shown.has('todo')).toBe(false)
  expect(await $.command.run(RUN)).toMatchObject({ text: `TODO pane opened: ${TODO}` })
  expect(shown.has('todo')).toBe(true)

  const ui = await $.ui.mount({
    plugin: 'todo-band',
    surface: 'terminal',
    component: 'Pane',
    props: { title: 'TODO.md' },
    requestId: 'todo',
  } as never)

  const texts = await ui.findAll({ type: 'Text' })
  const line = (text: string) => texts.find(one => one.text === text)
  expect(line('- [x] write mod')?.props.strikethrough).toBe(true)
  expect(line('- [ ] ship it')?.props.strikethrough).toBeFalsy()

  // 다른 탭 뒤에 있으면 닫지 않고 앞으로 가져오고, 앞에 있을 때 다시 실행하면 닫는다.
  tabs.push('other')
  expect(await $.command.run(RUN)).toMatchObject({ text: 'TODO pane brought to front.' })
  expect(tabs).toEqual(['other', 'todo'])

  expect(await $.command.run(RUN)).toMatchObject({ text: 'TODO pane closed.' })
  expect(shown.has('todo')).toBe(false)
})
