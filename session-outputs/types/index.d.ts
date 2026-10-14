// 표시 순서이기도 하다. file 은 Write/Edit 로 만든 파일, scratch 는 세션 scratchpad 의 파일.
export type ArtifactKind =
  | 'pr' | 'branch' | 'jira' | 'notion' | 'confluence' | 'slack' | 'github' | 'web' | 'file' | 'scratch'

export type Artifact = {
  kind: ArtifactKind
  label: string
  href?: string
  // file·scratch 의 절대 경로. p 로 복사하는 값이다.
  path?: string
  // file 이 지금은 지워졌으면 true. 링크는 확인하지 않는다.
  isGone?: boolean
}

export type SessionArtifacts = {
  id: string
  title: string
  // 세션이 작업한 worktree 경로(마지막 cwd)
  cwd?: string
  startedAt?: number
  endedAt?: number
  artifacts: Artifact[]
}

// 현재 세션의 산출물. 아직 읽지 않았으면 loadedAt 이 없다.
export type ArtifactIndex = {
  session?: SessionArtifacts
  loadedAt?: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'session-outputs': { index: ArtifactIndex; selected: number }
  }
}
