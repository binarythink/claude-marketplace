// 프롬프트 텍스트에서 개인정보로 보이는 항목을 찾는다.
// 결과에는 유형과 건수만 담는다. 감지한 값 자체는 이 모듈 밖으로 내보내지 않는다.

// block: 확인 없이 전송을 막는다 (고유식별정보).
// confirm: 전송 전에 한 번 더 묻는다.
export type Tier = 'block' | 'confirm'

export type Kind =
  | 'rrn'
  | 'foreignerRrn'
  | 'rrnLike'
  | 'passport'
  | 'driverLicense'
  | 'card'
  | 'account'
  | 'phone'
  | 'email'
  | 'address'

export type Finding = { kind: Kind; count: number }

export const TIER: Record<Kind, Tier> = {
  rrn: 'block',
  foreignerRrn: 'block',
  passport: 'block',
  driverLicense: 'block',
  rrnLike: 'confirm',
  card: 'confirm',
  account: 'confirm',
  phone: 'confirm',
  email: 'confirm',
  address: 'confirm',
}

export const LABEL: Record<Kind, string> = {
  rrn: '주민등록번호 형식',
  foreignerRrn: '외국인등록번호 형식',
  rrnLike: '주민등록번호로 보이는 숫자열',
  passport: '여권번호 형식',
  driverLicense: '운전면허번호 형식',
  card: '카드번호 형식',
  account: '계좌번호로 보이는 숫자열',
  phone: '휴대전화번호',
  email: '이메일 주소',
  address: '주소',
}

// 같은 유형 안에서는 이 순서로 정렬해 보여 준다.
const ORDER: readonly Kind[] = [
  'rrn', 'foreignerRrn', 'passport', 'driverLicense',
  'rrnLike', 'card', 'account', 'phone', 'email', 'address',
]

// 문맥 키워드가 값 앞뒤로 이 글자 수 안에 있어야 인정한다.
const CONTEXT_WINDOW = 24

const near = (text: string, start: number, end: number, keyword: RegExp) =>
  keyword.test(text.slice(Math.max(0, start - CONTEXT_WINDOW), end + CONTEXT_WINDOW))

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isBirthDate = (yymmdd: string) => {
  const month = Number(yymmdd.slice(2, 4))
  const day = Number(yymmdd.slice(4, 6))
  return month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month - 1]
}

// 주민·외국인등록번호: 생년월일 6자리 + 성별자리 1~8 + 6자리.
// 2020-10 이후 발급분은 뒤 6자리가 임의번호라 체크섬이 보장되지 않으므로 체크섬은 쓰지 않는다.
// 구분자(-, 공백)가 있으면 block, 13자리가 붙어 있으면 주문번호 등과 구분이 어려워 confirm.
const RRN = /(?<![\d-])(\d{6})([ \t]?-[ \t]?|[ \t])?([1-8])\d{6}(?![\d-])/g

function findRrn(text: string, add: (kind: Kind) => void) {
  for (const match of text.matchAll(RRN)) {
    const [, birth, separator, gender] = match
    if (!isBirthDate(birth)) continue
    if (separator === undefined) add('rrnLike')
    else add(Number(gender) >= 5 ? 'foreignerRrn' : 'rrn')
  }
}

// 여권번호: 구형 M12345678, 신형 M123A4567. 영문+숫자 식별자와 겹치므로 키워드가 있어야 인정한다.
const PASSPORT = /(?<![A-Za-z0-9])[MSRODG](?:\d{8}|\d{3}[A-Z]\d{4})(?![A-Za-z0-9])/g
const PASSPORT_KEYWORD = /여권|passport/i

// 운전면허번호: 지역코드(11~28)-연도2-일련6-검증2. 구분자가 없으면 키워드가 있어야 인정한다.
const LICENSE = /(?<![\d-])(1[1-9]|2[0-8])(-?)\d{2}\2\d{6}\2\d{2}(?![\d-])/g
const LICENSE_KEYWORD = /면허|license/i

// 휴대전화번호
const PHONE = /(?<![\d-])01[016789][-. ]?(\d{3,4})[-. ]?(\d{4})(?![\d-])/g

// 0000-0000, 1234-5678 처럼 예시로 흔히 쓰는 값
const isDummyPhone = (middle: string, last: string) => {
  const digits = middle + last
  return /^(\d)\1+$/.test(digits) || digits === '12345678' || digits === '1234567'
}

// 이메일 주소. 예약 도메인과 noreply 주소는 제외한다.
const EMAIL = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![A-Za-z0-9-])/g
const RESERVED_DOMAIN = /(^|\.)(example\.(com|net|org)|test|example|invalid|localhost)$/i
const NOREPLY = /(^|[.+-])no-?reply$/i

// 카드번호: 13~19자리 + Luhn + 발급사 접두(3,4,5,6,9).
// 4자리 묶음 구분자가 없으면 주문번호 등과 겹치므로 키워드가 있어야 인정한다.
const CARD = /(?<![\d-])(?:\d{4}[- ]){3}\d{1,7}(?![\d-])|(?<![\d-])\d{13,19}(?![\d-])/g
const CARD_KEYWORD = /카드|card/i
// 결제 대행사들이 공개한 테스트 카드번호
const TEST_CARDS = new Set([
  '4111111111111111', '4242424242424242', '4000056655665556', '4012888888881881',
  '5555555555554444', '5105105105105100', '2223003122003222',
  '378282246310005', '371449635398431', '6011111111111117', '3530111333300000',
])

const passesLuhn = (digits: string) => {
  let sum = 0
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
  }
  return sum % 10 === 0
}

// 계좌번호: 형식이 은행마다 달라 키워드가 있을 때만 인정한다.
const ACCOUNT = /(?<![\d-])(?:\d{2,6}-\d{2,6}-\d{2,7}(?:-\d{1,3})?|\d{10,14})(?![\d-])/g
const ACCOUNT_KEYWORD = /계좌|예금주|입금|은행|뱅크|농협|우체국|새마을금고|신협|account|bank/i

// 주소: 시·도 + 시·군·구 + 도로명/동 + 번지까지 이어질 때만 인정한다.
const ROAD_ADDRESS = /[가-힣]{1,10}(?:특별시|광역시|특별자치시|특별자치도|시|도)\s+[가-힣]{1,10}(?:시|군|구)\s+(?:[가-힣]{1,10}(?:시|군|구)\s+)?[가-힣0-9]{1,20}(?:로|길)\s*\d{1,5}(?:-\d{1,5})?/g
const LOT_ADDRESS = /[가-힣]{1,10}(?:시|군|구)\s+[가-힣0-9]{1,10}(?:동|읍|면|리|가)\s+(?:산\s*)?\d{1,5}(?:-\d{1,5})?(?:번지)?(?![\d-])/g

/** 텍스트에서 개인정보로 보이는 항목을 유형별 건수로 센다. */
export function detect(text: string): Finding[] {
  const counts = new Map<Kind, number>()
  const add = (kind: Kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1)
  // 앞에서 이미 다른 유형으로 센 숫자열을 계좌·카드로 다시 세지 않는다.
  const taken: Array<[number, number]> = []
  const isTaken = (start: number, end: number) => taken.some(([s, e]) => start < e && s < end)
  const take = (match: RegExpMatchArray) => taken.push([match.index!, match.index! + match[0].length])

  for (const match of text.matchAll(RRN)) {
    if (isBirthDate(match[1])) take(match)
  }
  findRrn(text, add)

  for (const match of text.matchAll(PASSPORT)) {
    if (near(text, match.index!, match.index! + match[0].length, PASSPORT_KEYWORD)) add('passport')
  }

  for (const match of text.matchAll(LICENSE)) {
    const start = match.index!
    const end = start + match[0].length
    if (isTaken(start, end)) continue
    if (match[2] === '-' || near(text, start, end, LICENSE_KEYWORD)) {
      add('driverLicense')
      take(match)
    }
  }

  for (const match of text.matchAll(PHONE)) {
    take(match)
    if (!isDummyPhone(match[1], match[2])) add('phone')
  }

  for (const match of text.matchAll(CARD)) {
    const start = match.index!
    const end = start + match[0].length
    if (isTaken(start, end)) continue
    const digits = match[0].replace(/[- ]/g, '')
    const isGrouped = digits.length !== match[0].length
    if (digits.length < 13 || digits.length > 19) continue
    if (!/^[345689]/.test(digits) || /^(\d)\1+$/.test(digits)) continue
    if (!passesLuhn(digits) || TEST_CARDS.has(digits)) continue
    if (!isGrouped && !near(text, start, end, CARD_KEYWORD)) continue
    add('card')
    take(match)
  }

  for (const match of text.matchAll(ACCOUNT)) {
    const start = match.index!
    const end = start + match[0].length
    if (isTaken(start, end)) continue
    const digits = match[0].replace(/-/g, '')
    // 2026-10-14 같은 날짜가 걸리지 않도록 10자리 이상만 본다.
    if (digits.length < 10 || /^(\d)\1+$/.test(digits)) continue
    if (near(text, start, end, ACCOUNT_KEYWORD)) add('account')
  }

  for (const match of text.matchAll(EMAIL)) {
    const [, local, domain] = match
    if (RESERVED_DOMAIN.test(domain) || NOREPLY.test(local)) continue
    if (domain.toLowerCase().endsWith('users.noreply.github.com')) continue
    add('email')
  }

  const addresses = new Set<number>()
  for (const pattern of [ROAD_ADDRESS, LOT_ADDRESS]) {
    for (const match of text.matchAll(pattern)) {
      // 도로명과 지번 패턴이 같은 위치를 함께 잡으면 한 건으로 센다.
      if ([...addresses].some(at => Math.abs(at - match.index!) < 20)) continue
      addresses.add(match.index!)
      add('address')
    }
  }

  return ORDER.filter(kind => counts.has(kind)).map(kind => ({ kind, count: counts.get(kind)! }))
}

/** 여러 출처의 결과를 유형별로 합친다. */
export function merge(...lists: Finding[][]): Finding[] {
  const counts = new Map<Kind, number>()
  for (const list of lists) {
    for (const { kind, count } of list) counts.set(kind, (counts.get(kind) ?? 0) + count)
  }
  return ORDER.filter(kind => counts.has(kind)).map(kind => ({ kind, count: counts.get(kind)! }))
}

/** "주민등록번호 형식 1건, 이메일 주소 2건" — 값은 담지 않는다. */
export const describeFindings = (findings: readonly Finding[]) =>
  findings.map(({ kind, count }) => `${LABEL[kind]} ${count}건`).join(', ')

/** 프롬프트에서 `@경로` 로 참조한 파일 경로를 뽑는다. MCP 리소스(`@server:uri`)는 제외한다. */
export function mentionedPaths(text: string): string[] {
  const paths = new Set<string>()
  for (const match of text.matchAll(/(?<![^\s(])@(?:"([^"\n]+)"|([^\s"'`)]+))/g)) {
    const path = (match[1] ?? match[2]).replace(/#L\d+(?:-\d+)?$/, '')
    if (path.includes(':') || path.endsWith('/')) continue
    paths.add(path)
  }
  return [...paths]
}
