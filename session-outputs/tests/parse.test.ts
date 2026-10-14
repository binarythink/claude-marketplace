import { describe, expect, test } from 'claude-code/testing'

import { branchesFromCommand, classifyUrl, displayPath, extractUrls, parseTranscript, parseWorktrees, slugOf } from '../hooks/parse'

describe('classifyUrl', () => {
  test('groups links by kind with short labels', () => {
    expect(classifyUrl('https://github.com/binarythink/claude-marketplace/pull/3/files'))
      .toEqual({ kind: 'pr', label: 'binarythink/claude-marketplace#3', href: 'https://github.com/binarythink/claude-marketplace/pull/3' })
    expect(classifyUrl('https://github.com/o/r/pull/new/feat/x-y'))
      .toEqual({ kind: 'branch', label: 'feat/x-y', href: 'https://github.com/o/r/tree/feat/x-y' })
    expect(classifyUrl('https://vroong-jira.atlassian.net/browse/ITSMCHG-123'))
      .toMatchObject({ kind: 'jira', label: 'ITSMCHG-123' })
    expect(classifyUrl('https://vroong-jira.atlassian.net/jira/software/projects/X/boards/1?selectedIssue=X-9'))
      .toMatchObject({ kind: 'jira', label: 'X-9', href: 'https://vroong-jira.atlassian.net/browse/X-9' })
    expect(classifyUrl('https://app.notion.com/p/vroong/ITS_PG_03_002-AI-3accf5759dc0804fbe8bc9c2b073ce3a'))
      .toMatchObject({ kind: 'notion', label: 'ITS_PG_03_002 AI' })
    expect(classifyUrl('https://www.notion.so/3accf5759dc0804fbe8bc9c2b073ce3a'))
      .toMatchObject({ kind: 'notion', label: 'Notion page' })
    expect(classifyUrl('https://vroong.atlassian.net/wiki/spaces/FIN/pages/123/Deploy+Plan'))
      .toMatchObject({ kind: 'confluence', label: 'Deploy Plan' })
    expect(classifyUrl('https://vroongcorp.slack.com/archives/C5F73HT37/p1787107955539639'))
      .toMatchObject({ kind: 'slack' })
    expect(classifyUrl('https://github.com/binarythink/claude-marketplace/tree/main/pii-guard'))
      .toMatchObject({ kind: 'github', label: 'binarythink/claude-marketplace/tree/main/pii-guard' })
    expect(classifyUrl('https://herdr.dev')).toMatchObject({ kind: 'web', label: 'herdr.dev' })
  })

  test('drops attribution links, API endpoints and cut-off hosts', () => {
    expect(classifyUrl('https://claude.com/claude-code')).toBeUndefined()
    expect(classifyUrl('https://code.claude.com')).toBeUndefined()
    expect(classifyUrl('https://claude.ai/code/session_011dTyqx9oSTMdphxbmpvyKC')).toBeUndefined()
    expect(classifyUrl('https://api.notion.com/v1/mcp/file_uploads/$2/send')).toBeUndefined()
    expect(classifyUrl('https://vroongcorp.slack')).toBeUndefined()
  })
})

test('extractUrls stops at markdown, quotes and Korean text', () => {
  expect(extractUrls('see [PR](https://github.com/o/r/pull/1), "https://herdr.dev"에서 https://a.io/x.'))
    .toEqual(['https://github.com/o/r/pull/1', 'https://herdr.dev', 'https://a.io/x'])
})

test('branchesFromCommand finds created and pushed branches', () => {
  expect(branchesFromCommand('git worktree add ../wt -b feat/a origin/main && git push -u origin feat/a'))
    .toEqual(['feat/a', 'feat/a'])
  expect(branchesFromCommand('git checkout -b fix/b; git switch -c "chore/c"')).toEqual(['fix/b', 'chore/c'])
  expect(branchesFromCommand('git checkout main && git push origin main')).toEqual([])
})

test('parseTranscript collects title, span, links, files and branches', () => {
  const lines = [
    { type: 'user', timestamp: '2026-10-15T00:00:00Z', cwd: '/r', gitBranch: 'main', message: { content: '<system-reminder>https://x.io/hidden</system-reminder>PR 만들어줘 https://vroong-jira.atlassian.net/browse/ABC-1' } },
    { type: 'assistant', timestamp: '2026-10-15T00:01:00Z', cwd: '/r', gitBranch: 'feat/a', message: { content: [
      { type: 'tool_use', id: 't1', name: 'Write', input: { file_path: '/r/a.ts', content: 'https://github.com/o/r/pull/9' } },
      { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'gh pr create --title x' } },
      { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/r/README.md' } },
    ] } },
    { type: 'user', timestamp: '2026-10-15T00:02:00Z', cwd: '/r', message: { content: [
      { type: 'tool_result', tool_use_id: 't2', content: 'https://github.com/o/r/pull/7\n' },
      { type: 'tool_result', tool_use_id: 't3', content: [{ type: 'text', text: 'https://example.com/readme' }] },
    ] } },
    { type: 'user', isMeta: true, message: { content: 'https://skill.example.com' } },
    { type: 'ai-title', aiTitle: '자동 제목' },
    { type: 'custom-title', customTitle: '작업 제목' },
  ]
  const parsed = parseTranscript(lines.map(one => JSON.stringify(one)).join('\n'))

  expect(parsed.title).toBe('작업 제목')
  expect(parsed.aiTitle).toBe('자동 제목')
  expect(parsed.firstPrompt).toBe('PR 만들어줘 https://vroong-jira.atlassian.net/browse/ABC-1')
  expect(parsed.startedAt).toBe(Date.parse('2026-10-15T00:00:00Z'))
  expect(parsed.endedAt).toBe(Date.parse('2026-10-15T00:02:00Z'))
  expect(parsed.files).toEqual(['/r/a.ts'])
  expect(parsed.branches).toEqual(['feat/a'])
  expect(parsed.links.map(one => one.label)).toEqual(['ABC-1', 'o/r#7'])
})

test('paths are shown relative to their worktree', () => {
  const roots = parseWorktrees('worktree /w/repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /w/repo-x\nHEAD def\n')
  expect(roots).toEqual(['/w/repo', '/w/repo-x'])
  expect(displayPath('/w/repo/a/b.ts', roots)).toBe('a/b.ts')
  expect(displayPath('/w/repo-x/c.ts', roots)).toBe('x:c.ts')
  expect(displayPath('/w/other/d.ts', [...roots, '/w/other'])).toBe('other:d.ts')
  expect(displayPath('/Users/me/notes.md', roots, '/Users/me')).toBe('~/notes.md')
  expect(slugOf('/Users/yongjik.kim/work/repo')).toBe('-Users-yongjik-kim-work-repo')
})

test('a pasted prompt counts as the first prompt', () => {
  const parsed = parseTranscript(JSON.stringify({
    type: 'user',
    message: { content: '\n\n<pasted_content id="fb19">\n검증용 산출물을 만들어줘 https://herdr.dev\n</pasted_content>' },
  }))
  expect(parsed.firstPrompt).toBe('검증용 산출물을 만들어줘 https://herdr.dev')
  expect(parsed.links.map(one => one.label)).toEqual(['herdr.dev'])
})
