// file 은 Write/Edit 나 Bash 명령(redirect, sed -i, cp, mv, tee 등)으로 만들거나 고친 파일, scratch 는 세션 scratchpad 의 파일.
export type ArtifactKind =
  | 'pr' | 'branch' | 'jira' | 'notion' | 'confluence' | 'slack' | 'github' | 'web' | 'file' | 'scratch'

// 처음 수집된 곳. input 은 사용자 메시지의 글, output 은 그 밖의 전부(assistant 의 글, 도구 입력,
// git·gh 명령의 입출력, checkout 된 branch, scratchpad 파일). pane 은 이 값으로 그룹을 나눈다.
export type ArtifactSource = 'input' | 'output'

export type Artifact = {
  kind: ArtifactKind
  // 행의 name 칸. file·scratch 는 파일 이름(basename)이다.
  label: string
  href?: string
  // file·scratch 의 절대 경로. p 로 복사하는 값이다.
  path?: string
  // file·scratch 의 worktree 기준 상대 경로 등. 행의 path 칸에는 이 경로의 폴더 부분이 보인다.
  displayPath?: string
  source: ArtifactSource
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
