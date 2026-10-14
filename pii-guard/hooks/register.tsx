import type { EngineInterface, Register } from 'claude-code'

import { describeFindings, detect, merge, mentionedPaths, TIER } from './detect'
import type { Finding } from './detect'

// 한 프롬프트에서 열어 볼 @참조 파일 수의 상한
const MAX_FILES = 20

export const SEND = '그래도 보내기'
export const HOLD = '보내지 않기'

export const BLOCK_REASON = (findings: readonly Finding[]) =>
  `고유식별정보(${describeFindings(findings)})가 감지되어 전송하지 않았습니다. `
  + '개인정보 보호법상 고유식별정보이므로 해당 값을 삭제하거나 마스킹한 뒤 다시 보내 주세요.'
export const CANCEL_REASON = '개인정보 확인 단계에서 전송을 취소했습니다.'
export const ERROR_REASON = '개인정보 검사 중 오류가 발생해 전송하지 않았습니다.'

// @경로 로 참조한 파일을 읽어 검사한다. 읽을 수 없는 경로(디렉터리, 4 MiB 초과, 멘션 등)는 건너뛴다.
async function scanMentions($: EngineInterface, text: string) {
  const results: Finding[][] = []
  for (const path of mentionedPaths(text).slice(0, MAX_FILES)) {
    const content = await $.fs.read(path).catch(() => undefined)
    if (typeof content === 'string') results.push(detect(content))
  }
  return merge(...results)
}

// 막힌 프롬프트는 엔진이 입력창에 되돌려 두므로 따로 채우지 않는다.
const drop = (reason: string) => ({ drop: reason })

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    const inPrompt = detect(e.text)
    const inFiles = await scanMentions($, e.text)
    const findings = merge(inPrompt, inFiles)
    const attachments = e.attachments?.length ?? 0
    if (findings.length === 0 && attachments === 0) return next(e)

    const blocked = findings.filter(({ kind }) => TIER[kind] === 'block')
    if (blocked.length > 0) return drop(BLOCK_REASON(blocked))

    const items: string[] = []
    if (findings.length > 0) {
      items.push(describeFindings(findings) + (inFiles.length > 0 ? ' (참조 파일 포함)' : ''))
    }
    if (attachments > 0) items.push(`이미지·문서 첨부 ${attachments}건 (내용은 검사하지 않음)`)

    // 물어볼 수 없는 경우(-p, SDK, 대화상자 닫음)에는 보내지 않는다.
    const answer = await $.ui
      .ask(`개인정보로 보이는 항목이 있습니다: ${items.join(', ')}. 그래도 보낼까요?`, {
        header: '개인정보',
        options: [HOLD, SEND],
      })
      .catch(() => undefined)
    if (answer === SEND) return next(e)

    return drop(CANCEL_REASON)
  }).catch(($, e, next) => (next.called ? next(e) : { drop: ERROR_REASON }))
}
