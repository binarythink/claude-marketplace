export type GraphLine = {
  graph: string
  hash?: string
  refs?: string
  subject?: string
  author?: string
  // author date, unix seconds
  time?: number
  isMerge?: boolean
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag' | 'other'

export type Ref = { name: string; kind: RefKind }

export type RepoStatus = {
  // undefined 면 detached HEAD
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  changed: number
}

export type GraphLog = {
  lines: GraphLine[]
  status?: RepoStatus
  error?: string
  loadedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'git-graph': { log: GraphLog; offset: number }
  }
}
