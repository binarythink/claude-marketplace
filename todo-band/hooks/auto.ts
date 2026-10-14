// /auto-todo 의 인자를 원하는 상태로 바꾼다. 빈 인자는 반전, 모르는 인자는 undefined.
export function parseAutoTodoArgs(args: string, isOn: boolean): boolean | undefined {
  const word = args.trim().toLowerCase()
  if (word === '') return !isOn
  if (word === 'on') return true
  if (word === 'off') return false
  return undefined
}

const ON = [
  'auto-todo is on: keep the plan for this session in TODO.jsonl in the session scratchpad, following the todo-band:todo-plan skill (load it if its rules are not in context).',
  'If this message asks for work (editing files, running commands, investigating), add items for it before you start: append them to the existing file, or create the file if there is none. Update each status as it changes.',
  'A question that needs no work gets no item. Track progress only in TODO.jsonl, not with the built-in TodoWrite or Task tools.',
].join(' ')

const NUDGE = 'Your last turn edited files or ran commands but did not update TODO.jsonl: bring it up to date with what was done before continuing.'

const OFF = 'auto-todo was turned off: stop maintaining TODO.jsonl on your own and change it only when the user asks.'

// 사용자 프롬프트에 붙일 context. 붙일 것이 없으면 undefined.
export function autoTodoContext(state: {
  isOn: boolean
  isOffNoticePending: boolean
  isNudgePending: boolean
}): string | undefined {
  if (!state.isOn) return state.isOffNoticePending ? OFF : undefined
  return state.isNudgePending ? `${ON}\n${NUDGE}` : ON
}
