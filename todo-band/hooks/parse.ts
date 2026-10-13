import type { TodoItem, TodoRow, TodoStatus } from '../types'

const STATUSES: readonly TodoStatus[] = ['todo', 'doing', 'waiting', 'done', 'cancelled']

const isStatus = (value: unknown): value is TodoStatus => STATUSES.includes(value as TodoStatus)

// JSONL 한 줄을 TodoItem 으로 읽는다. 형식이 틀리면 이유를 문자열로 돌려준다.
function parseItem(line: string): TodoItem | string {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return 'not valid JSON'
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'not a JSON object'
  const { id, title, status, deps = [], note } = value as Record<string, unknown>
  if (typeof id !== 'string' || id === '') return 'missing "id"'
  if (typeof title !== 'string') return `${id}: missing "title"`
  if (!isStatus(status)) return `${id}: "status" must be one of ${STATUSES.join(', ')}`
  if (!Array.isArray(deps) || deps.some(dep => typeof dep !== 'string')) return `${id}: "deps" must be an array of ids`
  if (note !== undefined && typeof note !== 'string') return `${id}: "note" must be a string`
  return { id, title, status, deps, ...(note ? { note } : {}) }
}

// TODO.jsonl 을 읽어 deps 기준 위상 정렬(파일 순서 유지)한 행과 경고 목록을 만든다.
// 깨진 줄·중복 id 는 건너뛰고, 없는 dep·순환 의존은 경고만 남기고 행은 그대로 보여준다.
export function parseTodoJsonl(text: string): { rows: TodoRow[]; errors: string[] } {
  const errors: string[] = []
  const items: TodoItem[] = []
  const byId = new Map<string, TodoItem>()

  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (line === '') return
    const item = parseItem(line)
    if (typeof item === 'string') {
      errors.push(`line ${index + 1}: ${item}`)
      return
    }
    if (byId.has(item.id)) {
      errors.push(`line ${index + 1}: duplicate id "${item.id}"`)
      return
    }
    byId.set(item.id, item)
    items.push(item)
  })

  for (const item of items) {
    for (const dep of item.deps) {
      if (dep === item.id) errors.push(`${item.id}: depends on itself`)
      else if (!byId.has(dep)) errors.push(`${item.id}: unknown dep "${dep}"`)
    }
  }

  // 남은 항목 중 known dep 이 모두 배치된 첫 항목을 고른다. 항목 수가 적어 O(n²) 로 충분하다.
  const ordered: TodoItem[] = []
  const placed = new Set<string>()
  const rest = [...items]
  while (rest.length > 0) {
    const at = rest.findIndex(item => item.deps.every(dep => placed.has(dep) || !byId.has(dep) || dep === item.id))
    if (at < 0) {
      errors.push(`dependency cycle among: ${rest.map(item => item.id).join(', ')}`)
      ordered.push(...rest)
      break
    }
    const item = rest.splice(at, 1)[0]!
    placed.add(item.id)
    ordered.push(item)
  }

  const rows = ordered.map(item => ({
    ...item,
    blockedBy: item.deps.filter(dep => byId.get(dep)?.status !== 'done'),
  }))
  return { rows, errors }
}

export type RowLook = {
  glyph: string
  color?: string
  bold?: boolean
  dimColor?: boolean
  strikethrough?: boolean
  // 상태 뒤에 붙이는 설명
  suffix?: string
}

// 행 하나의 표시 방식. todo 는 deps 가 남아 있으면 blocked, 아니면 바로 착수 가능(ready)으로 나눈다.
export function lookOf(row: TodoRow): RowLook {
  switch (row.status) {
    case 'done':
      return { glyph: '✓', dimColor: true, strikethrough: true }
    case 'cancelled':
      return { glyph: '✗', dimColor: true, strikethrough: true, suffix: 'cancelled' }
    case 'doing':
      return { glyph: '▶', color: 'claude', bold: true, suffix: 'agent running' }
    case 'waiting':
      return { glyph: '⏸', color: 'warning', bold: true, suffix: 'waiting on user' }
    case 'todo':
      return row.blockedBy.length > 0
        ? { glyph: '◌', dimColor: true, suffix: `after ${row.blockedBy.join(', ')}` }
        : { glyph: '○' }
  }
}

export function summaryOf(rows: TodoRow[]): string {
  const count = (status: TodoStatus) => rows.filter(row => row.status === status).length
  const active = rows.filter(row => row.status !== 'cancelled').length
  const parts = [`${count('done')}/${active} done`]
  if (count('doing') > 0) parts.push(`${count('doing')} running`)
  if (count('waiting') > 0) parts.push(`${count('waiting')} waiting on user`)
  const ready = rows.filter(row => row.status === 'todo' && row.blockedBy.length === 0).length
  if (ready > 0) parts.push(`${ready} ready`)
  return parts.join(' · ')
}
