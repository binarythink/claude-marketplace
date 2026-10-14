import { describe, expect, test } from 'claude-code/testing'

import { describeFindings, detect, mentionedPaths } from '../hooks/detect'

// 주민등록번호 형식 테스트 값은 실행 중에 조립하고, 체크섬을 통과하지 않는 값만 쓴다.
// 1990년생 번호는 2020-10 이전 발급분이라 체크섬이 맞지 않으면 실제로 발급될 수 없는 번호다.
const WEIGHTS = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5]
const rrnLike = (birth: string, gender: string, rest: string, separator = '-') => {
  const digits = birth + gender + rest
  const sum = WEIGHTS.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0)
  if ((11 - (sum % 11)) % 10 === Number(digits[12])) throw new Error('checksum-valid test value')
  return `${birth}${separator}${gender}${rest}`
}

const kinds = (text: string) => detect(text).map(({ kind, count }) => `${kind}:${count}`)

describe('detect: 고유식별정보', () => {
  test('주민등록번호 형식은 구분자가 있으면 rrn', async () => {
    expect(kinds(`고객 ${rrnLike('900101', '1', '000000')} 확인`)).toEqual(['rrn:1'])
    expect(kinds(`고객 ${rrnLike('900101', '2', '000000', ' ')} 확인`)).toEqual(['rrn:1'])
  })

  test('성별자리 5~8 은 외국인등록번호', async () => {
    expect(kinds(rrnLike('900101', '5', '000000'))).toEqual(['foreignerRrn:1'])
  })

  test('구분자 없는 13자리는 rrnLike (confirm 대상)', async () => {
    expect(kinds(`id=${rrnLike('900101', '1', '000000', '')}`)).toEqual(['rrnLike:1'])
  })

  test('생년월일이 아니거나 마스킹된 값은 무시한다', async () => {
    expect(kinds('000000-0000000')).toEqual([])
    expect(kinds('901301-1000000')).toEqual([])
    expect(kinds('900230-1000000')).toEqual([])
    expect(kinds('900101-1******')).toEqual([])
    expect(kinds('epoch 1789433187871')).toEqual([])
  })

  test('여권번호는 키워드가 있어야 인정한다', async () => {
    expect(kinds('여권번호 M12345678')).toEqual(['passport:1'])
    expect(kinds('passport: M123A4567')).toEqual(['passport:1'])
    expect(kinds('commit M12345678')).toEqual([])
  })

  test('운전면허번호는 구분자 형식이거나 키워드가 있어야 인정한다', async () => {
    expect(kinds('11-90-123456-01')).toEqual(['driverLicense:1'])
    expect(kinds('면허 119012345601')).toEqual(['driverLicense:1'])
    expect(kinds('order 119012345601')).toEqual([])
  })
})

describe('detect: 확인 대상', () => {
  test('휴대전화번호, 예시 번호는 제외', async () => {
    expect(kinds('연락처 010-9876-5432, 01098765433')).toEqual(['phone:2'])
    expect(kinds('010-0000-0000 010-1234-5678 010-1111-1111')).toEqual([])
  })

  test('이메일, 예약 도메인과 noreply 는 제외', async () => {
    expect(kinds('담당 hong.gildong@corp.co.kr')).toEqual(['email:1'])
    expect(kinds('a@example.com b@foo.test noreply@anthropic.com 1+x@users.noreply.github.com')).toEqual([])
  })

  test('카드번호: 묶음 형식은 Luhn, 붙은 숫자는 키워드까지 본다', async () => {
    expect(kinds('5200-8282-8282-8210')).toEqual(['card:1'])
    expect(kinds('카드 5200828282828210')).toEqual(['card:1'])
    expect(kinds('order 5200828282828210')).toEqual([])
    expect(kinds('5200-8282-8282-8211')).toEqual([])
    expect(kinds('카드 4111-1111-1111-1111')).toEqual([])
  })

  test('계좌번호는 키워드가 있어야 인정하고 날짜는 무시한다', async () => {
    expect(kinds('입금 계좌 123-456789-01-012')).toEqual(['account:1'])
    expect(kinds('국민은행 12345678901234')).toEqual(['account:1'])
    expect(kinds('입금일 2026-10-14')).toEqual([])
    expect(kinds('build 123-456789-01-012')).toEqual([])
  })

  test('주소는 시·도부터 번지까지 이어질 때만 인정한다', async () => {
    expect(kinds('서울특별시 강남구 테헤란로 123 4층')).toEqual(['address:1'])
    expect(kinds('경기도 성남시 분당구 판교역로 235')).toEqual(['address:1'])
    expect(kinds('서울시 마포구 합정동 123-45')).toEqual(['address:1'])
    expect(kinds('테헤란로 쪽 식당')).toEqual([])
  })

  test('평범한 개발 텍스트는 감지하지 않는다', async () => {
    const code = [
      'const id = "550e8400-e29b-41d4-a716-446655440000"',
      'git commit c3a4889 at 2026-10-14T12:00:00Z',
      'port 8080, version 2.1.299, PR #2',
      'SELECT * FROM orders WHERE order_id = 2026101400001',
    ].join('\n')
    expect(kinds(code)).toEqual([])
  })
})

describe('describeFindings', () => {
  test('유형과 건수만 담고 값은 담지 않는다', async () => {
    const value = rrnLike('900101', '1', '000000')
    const text = describeFindings(detect(`${value} hong@corp.co.kr`))
    expect(text).toBe('주민등록번호 형식 1건, 이메일 주소 1건')
    expect(text.includes(value)).toBe(false)
  })
})

describe('mentionedPaths', () => {
  test('@경로를 뽑고 MCP 리소스, 디렉터리, 이메일은 제외한다', async () => {
    expect(mentionedPaths('봐줘 @src/a.ts @"docs/my file.md" @src/b.ts#L1-20 (@c.txt)')).toEqual([
      'src/a.ts', 'docs/my file.md', 'src/b.ts', 'c.txt',
    ])
    expect(mentionedPaths('@github:repo://x @src/ hong@corp.co.kr')).toEqual([])
  })
})
