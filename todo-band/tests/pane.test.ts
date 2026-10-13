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
  on('command.register', () => ({ value: undefined }))
  const shown = new Set<string>()
  on('ui.open', (_$, e) => {
    shown.add(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    shown.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...shown].map(id => ({ id, title: 'TODO.md', isShown: true, isFocused: false, isPlaced: true })) as never,
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

  expect(await $.command.run(RUN)).toMatchObject({ text: 'TODO pane closed.' })
  expect(shown.has('todo')).toBe(false)
})
