import { describe, expect, test } from 'claude-code/testing'

import { CANCEL_REASON, HOLD, SEND } from '../hooks/register'

// 체크섬이 맞지 않는 1990년생 형식 (detect.test.ts 참고)
const RRN_LIKE = ['900101', '1000000'].join('-')

const submit = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  wait: false,
  origin: { kind: 'composer' as const },
  ...extra,
})

// AskUserQuestion 대화상자에 answer 로 답한다. answer 가 없으면 대화상자를 닫은 것으로 본다.
const answering = (answer: string | undefined, asked: string[]) =>
  async (_$: unknown, e: { questions: Array<{ question: string }> }) => {
    const { question } = e.questions[0]
    asked.push(question)
    if (answer === undefined) return { deny: 'dismissed' }
    return { result: { questions: e.questions, answers: { [question]: answer } } } as never
  }

describe('prompt.submit', () => {
  test('개인정보가 없으면 묻지 않고 보낸다', async ($, on) => {
    const sent: string[] = []
    const asked: string[] = []
    on('prompt.submit', async ($, e) => (sent.push(e.text), { text: e.text }))
    on('tool.call', { tool: 'AskUserQuestion' }, answering(SEND, asked))

    await $.prompt.submit(submit('리팩터링해 줘'))
    expect(sent).toHaveLength(1)
    expect(asked).toEqual([])
  })

  test('고유식별정보는 묻지 않고 막는다', async ($, on) => {
    const sent: string[] = []
    const asked: string[] = []
    on('prompt.submit', async ($, e) => (sent.push(e.text), { text: e.text }))
    on('tool.call', { tool: 'AskUserQuestion' }, answering(SEND, asked))

    const result = await $.prompt.submit(submit(`고객 ${RRN_LIKE} 조회`))
    expect(sent).toHaveLength(0)
    expect(asked).toEqual([])
    const reason = 'drop' in result ? (result.drop ?? '') : ''
    expect(reason).toContain('주민등록번호 형식 1건')
    expect(reason.includes(RRN_LIKE)).toBe(false)
  })

  test('확인 대상은 묻고, 그래도 보내기를 고르면 보낸다', async ($, on) => {
    const sent: string[] = []
    const asked: string[] = []
    on('prompt.submit', async ($, e) => (sent.push(e.text), { text: e.text }))
    on('tool.call', { tool: 'AskUserQuestion' }, answering(SEND, asked))

    await $.prompt.submit(submit('담당자 hong@corp.co.kr 에게 메일'))
    expect(sent).toHaveLength(1)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('이메일 주소 1건')
    expect(asked[0].includes('hong@corp.co.kr')).toBe(false)
  })

  test('보내지 않기를 고르거나 대화상자를 닫으면 막는다', async ($, on) => {
    const sent: string[] = []
    const asked: string[] = []
    let answer: string | undefined = HOLD
    on('prompt.submit', async ($, e) => (sent.push(e.text), { text: e.text }))
    on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => answering(answer, asked)($, e))

    const held = await $.prompt.submit(submit('연락처 010-9876-5432'))
    answer = undefined
    const dismissed = await $.prompt.submit(submit('연락처 010-9876-5432'))
    expect(sent).toHaveLength(0)
    expect(held).toEqual({ drop: CANCEL_REASON })
    expect(dismissed).toEqual({ drop: CANCEL_REASON })
  })

  test('첨부가 있으면 내용과 관계없이 묻는다', async ($, on) => {
    const asked: string[] = []
    on('prompt.submit', async ($, e) => ({ text: e.text }))
    on('tool.call', { tool: 'AskUserQuestion' }, answering(SEND, asked))

    await $.prompt.submit(submit('이 화면 봐줘', { attachments: [{ type: 'image', mediaType: 'image/png' }] }))
    expect(asked[0]).toContain('이미지·문서 첨부 1건')
  })

  test('@참조 파일 안의 고유식별정보도 막는다', async ($, on) => {
    const sent: string[] = []
    on('prompt.submit', async ($, e) => (sent.push(e.text), { text: e.text }))
    on('fs.read', async ($, e) => {
      if (e.path.endsWith('data/users.csv')) return { value: `name,rrn\nhong,${RRN_LIKE}\n` }
      throw new Error('ENOENT')
    })

    const result = await $.prompt.submit(submit('@data/users.csv 요약해 줘 @fintech-dev'))
    expect(sent).toHaveLength(0)
    expect('drop' in result ? result.drop : '').toContain('주민등록번호 형식 1건')
  })

  test('대화상자가 실패해도 보내지 않는다', async ($, on) => {
    const sent: string[] = []
    on('prompt.submit', async ($, e) => (sent.push(e.text), { text: e.text }))
    on('tool.call', { tool: 'AskUserQuestion' }, async () => {
      throw new Error('boom')
    })

    const result = await $.prompt.submit(submit('연락처 010-9876-5432'))
    expect(sent).toHaveLength(0)
    expect(result).toEqual({ drop: CANCEL_REASON })
  })
})
