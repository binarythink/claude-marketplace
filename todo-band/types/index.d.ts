export type TodoFile = { path: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'todo-band': { todo: TodoFile | null }
  }
}
