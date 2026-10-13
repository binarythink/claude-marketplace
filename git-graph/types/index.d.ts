export type GraphLine = {
  graph: string
  hash?: string
  refs?: string
  subject?: string
  author?: string
  date?: string
}

export type GraphLog = {
  lines: GraphLine[]
  error?: string
  loadedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'git-graph': { log: GraphLog; offset: number }
  }
}
