// doing: agent 가 직접 실행 중, waiting: 사용자가 실행하거나 결과를 확인해 주기를 기다리는 중
export type TodoStatus = 'todo' | 'doing' | 'waiting' | 'done' | 'cancelled'

export type TodoItem = {
  id: string
  title: string
  status: TodoStatus
  deps: string[]
  note?: string
}

// 렌더링 단위. blockedBy 는 저장값이 아니라 deps 중 아직 done 이 아닌 id 로 계산한 값이다.
export type TodoRow = TodoItem & { blockedBy: string[] }

export type TodoFile =
  | { format: 'md'; path: string; text: string }
  | { format: 'jsonl'; path: string; rows: TodoRow[]; errors: string[] }

declare module 'claude-code' {
  interface PluginState {
    'todo-band': { todo: TodoFile | null }
  }
}
