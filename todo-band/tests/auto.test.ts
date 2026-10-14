import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { autoTodoContext, parseAutoTodoArgs } from '../hooks/auto'

const SESSION = 'abc-123'
const BASE = '/private/tmp/claude-501'
const PAD = `${BASE}/-Users-me-proj/${SESSION}/scratchpad`
const JSONL = `${PAD}/TODO.jsonl`

const run = (args: string) => ({
  command: 'auto-todo',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
})

const submit = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  wait: false,
  origin: { kind: 'composer' as const },
  ...extra,
})

type Engine = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

const dir = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })

// 세션과 scratchpad 를 흉내 내고, prompt.submit 이 모델에 넘긴 context 를 모은다.
// file.mtimeMs 를 바꾸면 TODO.jsonl 이 갱신된 것으로 본다(-1 은 파일 없음).
async function setup($: Engine, on: On) {
  mock.clock(on)
  mock.env(on, {})
  const file = { mtimeMs: -1 }
  const contexts: Array<readonly string[] | undefined> = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: '/Users/me/proj' }))
  on('session.cwd', () => ({ value: '/Users/me/proj' }))
  on('fs.list', (_$, e) => ({ value: e.path === '/private/tmp' ? [dir('claude-501')] : [] }))
  on('fs.exists', (_$, e) => ({ value: e.path === PAD }))
  on('fs.stat', (_$, e) => {
    if (e.path !== JSONL || file.mtimeMs < 0) throw new Error('ENOENT')
    return { value: { kind: 'file' as const, size: 10, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', () => ({ value: '' }))
  on('prompt.submit', (_$, e) => (contexts.push(e.context), { text: e.text, context: e.context }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: { text: 'ok' } }) as never)

  await $.session.start({ cwd: '/Users/me/proj', surface: 'terminal', isInteractive: true })
  return { file, contexts }
}

// 메인 루프의 한 턴: 시작, 도구 호출(있으면), 응답 완료.
async function turn($: Engine, id: string, tool?: string) {
  await $.turn.start({ text: '', turnId: id })
  if (tool) await $.tool.call({ tool, tool_use_id: `${id}-tool`, command: 'true' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: id } as never)
}

describe('parseAutoTodoArgs', () => {
  test('toggles with no argument and reads on/off', () => {
    expect(parseAutoTodoArgs('', false)).toBe(true)
    expect(parseAutoTodoArgs('  ', true)).toBe(false)
    expect(parseAutoTodoArgs('ON', false)).toBe(true)
    expect(parseAutoTodoArgs('off', true)).toBe(false)
    expect(parseAutoTodoArgs('maybe', true)).toBeUndefined()
  })
})

describe('autoTodoContext', () => {
  test('adds nothing while off unless an off notice is pending', () => {
    expect(autoTodoContext({ isOn: false, isOffNoticePending: false, isNudgePending: true })).toBeUndefined()
    expect(autoTodoContext({ isOn: false, isOffNoticePending: true, isNudgePending: false })).toContain('turned off')
  })

  test('points at TODO.jsonl while on and appends the nudge when pending', () => {
    const on = autoTodoContext({ isOn: true, isOffNoticePending: false, isNudgePending: false })
    expect(on).toContain('TODO.jsonl')
    expect(on).not.toContain('did not update')
    expect(autoTodoContext({ isOn: true, isOffNoticePending: false, isNudgePending: true })).toContain('did not update')
  })
})

describe('/auto-todo', () => {
  test('starts off and adds no context until turned on', async ($, on) => {
    const { contexts } = await setup($, on)

    await $.prompt.submit(submit('리팩터링해 줘'))
    expect(contexts.at(-1)).toBeUndefined()

    expect(await $.command.run(run('on'))).toMatchObject({ text: expect.stringContaining('auto-todo on') })
    expect(await $.command.run(run('on'))).toMatchObject({ text: 'auto-todo is already on.' })
    await $.prompt.submit(submit('테스트도 추가해 줘'))
    expect(contexts.at(-1)?.[0]).toContain('TODO.jsonl')

    // 슬래시 명령과 사용자가 직접 치지 않은 프롬프트에는 붙이지 않는다.
    await $.prompt.submit(submit('notification', { isMeta: true }))
    expect(contexts.at(-1)).toBeUndefined()
  })

  test('sends a one-shot notice after turning off', async ($, on) => {
    const { contexts } = await setup($, on)
    await $.command.run(run('on'))

    expect(await $.command.run(run(''))).toMatchObject({ text: expect.stringContaining('auto-todo off') })
    await $.prompt.submit(submit('다음 작업'))
    expect(contexts.at(-1)?.[0]).toContain('turned off')
    await $.prompt.submit(submit('또 다음 작업'))
    expect(contexts.at(-1)).toBeUndefined()
  })

  test('rejects an unknown argument', async ($, on) => {
    await setup($, on)
    expect(await $.command.run(run('maybe'))).toMatchObject({ text: 'Usage: /auto-todo [on|off] (now off)' })
  })

  test('starts on when autoTodoDefault is set', { options: { autoTodoDefault: true } }, async ($, on) => {
    const { contexts } = await setup($, on)
    await $.prompt.submit(submit('작업'))
    expect(contexts.at(-1)?.[0]).toContain('TODO.jsonl')
  })
})

describe('nudge', () => {
  test('reminds once after a working turn that left TODO.jsonl untouched', async ($, on) => {
    const { contexts } = await setup($, on)
    await $.command.run(run('on'))

    await turn($, 't1', 'Bash')
    await $.prompt.submit(submit('다음'))
    expect(contexts.at(-1)?.[0]).toContain('did not update')
    await $.prompt.submit(submit('그다음'))
    expect(contexts.at(-1)?.[0]).not.toContain('did not update')
  })

  test('stays quiet when TODO.jsonl changed or no work was done', async ($, on) => {
    const { file, contexts } = await setup($, on)
    await $.command.run(run('on'))

    // 질문만 한 턴
    await turn($, 't1', 'Read')
    await $.prompt.submit(submit('다음'))
    expect(contexts.at(-1)?.[0]).not.toContain('did not update')

    // 작업하면서 TODO.jsonl 도 갱신한 턴
    await $.turn.start({ text: '', turnId: 't2' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 't2-tool', command: 'true' } as never)
    file.mtimeMs = 5
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 't2' } as never)
    await $.prompt.submit(submit('그다음'))
    expect(contexts.at(-1)?.[0]).not.toContain('did not update')
  })

  test('ignores subagent turns', async ($, on) => {
    const { contexts } = await setup($, on)
    await $.command.run(run('on'))

    await $.turn.start({ text: '', turnId: 'a1', agentId: 'sub' })
    await $.tool.call({ tool: 'Bash', tool_use_id: 'a1-tool', command: 'true', agentId: 'sub' } as never)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1, isAborted: false, turnId: 'a1', agentId: 'sub' } as never)
    await $.prompt.submit(submit('다음'))
    expect(contexts.at(-1)?.[0]).not.toContain('did not update')
  })
})
