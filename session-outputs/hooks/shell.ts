// Bash 명령 한 줄이 쓰는 파일 경로를 찾는다. 셸을 실행하지 않고 글자만 읽으므로, 같은 명령 안에서
// 정한 변수(f=...; cat >> "$f")와 cd 는 따라가고, $(...)·`...` 처럼 실행해야 아는 값은 모르는 값으로 둔다.

// 실행해야 아는 값($(date), 정의하지 않은 $VAR)이 들어간 자리
const UNKNOWN = '\u0000'

export type WrittenFile = {
  // 절대 경로. namePattern 이 있으면 이 경로의 파일 이름 부분은 자리표시자다.
  path: string
  // 파일 이름에 실행해야 아는 값이 들어 있을 때 그 이름의 정규식(cp f "f.bak.$(date +%s)")
  namePattern?: string
  // cp·mv 의 대상이 폴더일 수도 있을 때, 폴더라면 그 안에 생기는 파일 이름
  intoDirName?: string
}

type Part = { text: string; quote: '' | "'" | '"' } | { sub: true }
type Word = Part[]
type Token = { op: string } | { redirect: string } | { word: Word }

const isWord = (token: Token | undefined): token is { word: Word } => !!token && 'word' in token

const literalOf = (word: Word) => word.map(part => ('text' in part ? part.text : '')).join('')

// i 의 '(' 와 짝인 ')' 다음 위치. 안의 따옴표는 건너뛴다.
function closingParen(src: string, i: number): number {
  let depth = 0
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '\\') i++
    else if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1)
      i = end < 0 ? src.length : end
    } else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return src.length
}

// 명령을 단어·연산자·redirect 로 나눈다. heredoc 본문은 버린다.
function lex(src: string): Token[] {
  const tokens: Token[] = []
  const heredocs: { delimiter: string; isIndented: boolean }[] = []
  let word: Word | undefined
  let text = ''

  const flushText = () => {
    if (text) (word ??= []).push({ text, quote: '' })
    text = ''
  }
  const endWord = () => {
    flushText()
    if (!word) return
    const before = tokens[tokens.length - 1]
    if (before && 'redirect' in before && before.redirect.startsWith('<<') && before.redirect !== '<<<') {
      heredocs.push({ delimiter: literalOf(word), isIndented: before.redirect === '<<-' })
    }
    tokens.push({ word })
    word = undefined
  }
  const op = (value: string) => {
    endWord()
    tokens.push({ op: value })
  }

  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const two = src.slice(i, i + 2)
    if (c === '\n') {
      op(';')
      i++
      // 줄바꿈 다음은 heredoc 본문이다. 구분자만 있는 줄까지 건너뛴다.
      for (const doc of heredocs.splice(0)) {
        while (i < src.length) {
          const end = src.indexOf('\n', i)
          const line = src.slice(i, end < 0 ? src.length : end)
          i = end < 0 ? src.length : end + 1
          if ((doc.isIndented ? line.replace(/^\t+/, '') : line) === doc.delimiter) break
        }
      }
    } else if (c === ' ' || c === '\t') {
      endWord()
      i++
    } else if (c === '#' && !word && !text) {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === ';' || c === '(' || c === ')') {
      op(';')
      i++
    } else if (two === '&&' || two === '||' || two === '|&') {
      op(two)
      i += 2
    } else if (two === '&>') {
      endWord()
      const value = src.slice(i, i + 3) === '&>>' ? '&>>' : '&>'
      tokens.push({ redirect: value })
      i += value.length
    } else if (c === '&' || c === '|') {
      op(c)
      i++
    } else if (c === '>' || c === '<') {
      // 2>err.log 의 2 는 fd 번호라 단어가 아니다.
      if (!word && /^\d+$/.test(text)) text = ''
      endWord()
      const value = src.slice(i).match(/^(>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/)![1]!
      tokens.push({ redirect: value })
      i += value.length
    } else if (c === "'") {
      flushText()
      const end = src.indexOf("'", i + 1)
      ;(word ??= []).push({ text: src.slice(i + 1, end < 0 ? src.length : end), quote: "'" })
      i = end < 0 ? src.length : end + 1
    } else if (c === '"') {
      flushText()
      word ??= []
      let inner = ''
      i++
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          inner += /[$`"\\\n]/.test(src[i + 1]!) ? src[i + 1] : src.slice(i, i + 2)
          i += 2
        } else if (src.startsWith('$(', i) || src[i] === '`') {
          if (inner) word.push({ text: inner, quote: '"' })
          inner = ''
          word.push({ sub: true })
          i = src[i] === '`' ? src.indexOf('`', i + 1) + 1 || src.length : closingParen(src, i + 1)
        } else {
          inner += src[i++]
        }
      }
      if (inner || word.length === 0) word.push({ text: inner, quote: '"' })
      i++
    } else if (c === '\\') {
      flushText()
      if (src[i + 1] !== '\n') (word ??= []).push({ text: src[i + 1] ?? '', quote: "'" })
      i += 2
    } else if (two === '$(' || c === '`') {
      flushText()
      ;(word ??= []).push({ sub: true })
      i = c === '`' ? src.indexOf('`', i + 1) + 1 || src.length : closingParen(src, i + 1)
    } else {
      text += c
      i++
    }
  }
  endWord()
  return tokens
}

type Scope = { cwd?: string; home?: string; vars: Map<string, string> }

// 단어를 셸처럼 펼친다. 따옴표 없는 *?[ 가 있으면 glob 이라 경로로 쓰지 않는다.
function expand(word: Word, scope: Scope): { value: string; isGlob: boolean } {
  let value = ''
  let isGlob = false
  word.forEach((part, at) => {
    if (!('text' in part)) {
      value += UNKNOWN
      return
    }
    if (part.quote === "'") {
      value += part.text
      return
    }
    let text = part.text
    // ~ 는 단어 맨 앞과 대입의 = 바로 뒤(f=~/x)에서 펼친다.
    if (part.quote === '' && at === 0 && scope.home) text = text.replace(/^((?:[A-Za-z_]\w*=)?)~(?=\/|$)/, `$1${scope.home}`)
    if (part.quote === '' && /[*?[]/.test(text)) isGlob = true
    value += text.replace(/\$(?:\{(\w+)\}|(\w+))/g, (_, braced: string, bare: string) => {
      const name = braced ?? bare
      return scope.vars.get(name) ?? (name === 'HOME' && scope.home ? scope.home : UNKNOWN)
    })
  })
  return { value, isGlob }
}

// . 과 .. 을 걷어낸 절대 경로. 상대 경로인데 cwd 를 모르면 undefined.
function absolute(path: string, cwd: string | undefined): string | undefined {
  if (!path.startsWith('/') && !cwd) return undefined
  const segments: string[] = []
  for (const one of (path.startsWith('/') ? path : `${cwd}/${path}`).split('/')) {
    if (one === '..') segments.pop()
    else if (one && one !== '.') segments.push(one)
  }
  return `/${segments.join('/')}`
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? ''

// 펼친 값 하나를 쓴 파일로 만든다. 폴더 부분을 모르거나 glob·장치 파일이면 버린다.
function fileOf(value: string, isGlob: boolean, scope: Scope): WrittenFile | undefined {
  if (!value || value === '-' || isGlob) return undefined
  const path = absolute(value, scope.cwd)
  if (!path || path === '/' || path.startsWith('/dev/') || path.startsWith('/proc/')) return undefined
  const name = baseName(path)
  if (path.slice(0, path.length - name.length).includes(UNKNOWN)) return undefined
  if (!name.includes(UNKNOWN)) return { path }
  if (name.replaceAll(UNKNOWN, '') === '') return undefined
  return {
    path: path.replaceAll(UNKNOWN, '*'),
    namePattern: `^${name.split(UNKNOWN).map(escapeRe).join('.+')}$`,
  }
}

// 옵션을 걷어낸 인자. withValue 의 옵션은 다음 인자를 값으로 가져간다.
function positionals(args: string[], withValue: string[] = []): { values: string[]; options: Map<string, string> } {
  const values: string[] = []
  const options = new Map<string, string>()
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      values.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('-') && arg.length > 1) {
      const [name, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg]
      if (inline !== undefined) options.set(name!, inline)
      else if (withValue.includes(arg)) options.set(arg, args[++i] ?? '')
      else options.set(arg, '')
      continue
    }
    values.push(arg)
  }
  return { values, options }
}

// sed -i, perl -i 가 고치는 파일. -e·-f 가 없으면 첫 인자가 script 다.
function inPlaceTargets(name: 'sed' | 'perl', args: string[]): string[] {
  let isInPlace = false
  let hasScript = false
  const values: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--') {
      values.push(...args.slice(i + 1))
      break
    }
    if (arg.startsWith('--')) {
      if (arg.startsWith('--in-place')) isInPlace = true
      if (/^--(expression|file)=/.test(arg)) hasScript = true
      else if (arg === '--expression' || arg === '--file') {
        hasScript = true
        i++
      }
      continue
    }
    if (!arg.startsWith('-') || arg.length === 1) {
      values.push(arg)
      continue
    }
    const flags = arg.slice(1)
    for (let j = 0; j < flags.length; j++) {
      const flag = flags[j]!
      const isLast = j === flags.length - 1
      if (flag === 'i') {
        isInPlace = true
        // BSD sed 는 -i 다음 인자가 백업 확장자다(-i '' 또는 -i .bak).
        if (name === 'sed' && isLast && /^(\.[^\s/]*)?$/.test(args[i + 1] ?? '-')) i++
        break
      }
      if (flag === 'e' || flag === 'f' || (name === 'perl' && flag === 'E')) {
        hasScript = true
        if (isLast) i++
        break
      }
      if (name === 'perl' && /[MmIlx0]/.test(flag)) break
    }
  }
  if (!isInPlace) return []
  return hasScript ? values : values.slice(1)
}

const SHELLS = new Set(['sh', 'bash', 'zsh'])
const WRAPPERS = new Set(['sudo', 'command', 'nohup', 'time', 'exec', 'builtin'])
const DECLARES = new Set(['export', 'local', 'declare', 'typeset', 'readonly'])
const ASSIGN_RE = /^([A-Za-z_]\w*)=/s

// 'f=x' 처럼 이름이 따옴표 밖에 있어야 대입이다. "f=x" 는 명령 이름이다.
const isAssignment = ({ value, raw }: { value: string; raw: Word }) => {
  const first = raw[0]
  return ASSIGN_RE.test(value) && !!first && 'text' in first && first.quote === ''
}

// 단순 명령 하나(argv)가 쓰는 파일을 모으고, 변수 대입과 cd 는 scope 에 반영한다.
function runSimple(words: { value: string; isGlob: boolean; raw: Word }[], scope: Scope, out: WrittenFile[]) {
  let at = 0
  // FOO=1 cmd 의 FOO 는 그 명령에만 쓰인다. 명령 없이 대입만 있으면 이후 명령에 남는다.
  const assigns: [string, string][] = []
  while (at < words.length && isAssignment(words[at]!)) {
    const [, name] = words[at]!.value.match(ASSIGN_RE)!
    assigns.push([name!, words[at]!.value.slice(name!.length + 1)])
    at++
  }
  if (at === words.length) {
    for (const [name, value] of assigns) scope.vars.set(name, value)
    return
  }
  while (at < words.length && WRAPPERS.has(baseName(words[at]!.value))) at++
  if (words[at]?.value === 'env') {
    at++
    while (at < words.length && (ASSIGN_RE.test(words[at]!.value) || words[at]!.value.startsWith('-'))) at++
  }

  const name = baseName(words[at]?.value ?? '')
  const rest = words.slice(at + 1)
  const args = rest.map(one => one.value)
  const add = (value: string, extra?: Partial<WrittenFile>) => {
    const word = rest.find(one => one.value === value)
    const file = fileOf(value, word?.isGlob ?? false, scope)
    if (file) out.push(file.namePattern ? file : { ...file, ...extra })
  }

  if (DECLARES.has(name)) {
    for (const value of args) {
      const match = value.match(ASSIGN_RE)
      if (match) scope.vars.set(match[1]!, value.slice(match[1]!.length + 1))
    }
  } else if (name === 'cd' || name === 'pushd') {
    const target = positionals(args).values[0]
    if (target === '-') return
    const next = target === undefined ? scope.home : target.includes(UNKNOWN) ? undefined : absolute(target, scope.cwd)
    scope.cwd = next
  } else if (name === 'sed' || name === 'gsed' || name === 'perl') {
    for (const value of inPlaceTargets(name === 'perl' ? 'perl' : 'sed', args)) add(value)
  } else if (name === 'cp' || name === 'mv' || name === 'install') {
    const { values, options } = positionals(args, ['-t', '-m', '-o', '-g', '-S', '--target-directory', '--suffix', '--mode', '--owner', '--group'])
    if (name === 'install' && options.has('-d')) return
    const into = options.get('-t') ?? options.get('--target-directory')
    const sources = into === undefined ? values.slice(0, -1) : values
    const dir = into ?? values[values.length - 1]
    if (dir === undefined || sources.length === 0) return
    if (into === undefined && sources.length === 1 && !dir.endsWith('/')) {
      const fromName = baseName(sources[0]!)
      add(dir, fromName && !fromName.includes(UNKNOWN) ? { intoDirName: fromName } : undefined)
      return
    }
    for (const source of sources) {
      const fromName = baseName(source)
      const file = fromName && !fromName.includes(UNKNOWN) && fileOf(`${dir.replace(/\/+$/, '')}/${fromName}`, false, scope)
      if (file) out.push(file)
    }
  } else if (name === 'tee') {
    for (const value of positionals(args).values) add(value)
  } else if (name === 'touch') {
    for (const value of positionals(args, ['-t', '-r', '-d']).values) add(value)
  } else if (name === 'curl') {
    args.forEach((arg, i) => {
      if (arg === '--output' || /^-[A-Za-z]*o$/.test(arg)) add(args[i + 1] ?? '')
      else if (arg.startsWith('--output=')) add(arg.slice('--output='.length))
      else if (/^-o./.test(arg)) add(arg.slice(2))
    })
  } else if (name === 'dd') {
    for (const arg of args) if (arg.startsWith('of=')) add(arg.slice(3))
  } else if (SHELLS.has(name)) {
    const script = args[args.indexOf('-c') + 1]
    if (args.includes('-c') && script !== undefined && !script.includes(UNKNOWN)) {
      out.push(...writtenFiles(script, { cwd: scope.cwd, home: scope.home, vars: new Map(scope.vars) }))
    }
  }
}

const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])

// command 를 cwd 에서 실행했을 때 만들거나 고치는 파일들. 명령에 나온 순서대로, 겹쳐도 그대로 둔다.
export function writtenFiles(
  command: string,
  { cwd, home, vars = new Map() }: { cwd?: string; home?: string; vars?: Map<string, string> },
): WrittenFile[] {
  const scope: Scope = { cwd, home, vars }
  const out: WrittenFile[] = []
  const tokens = lex(command)
  let words: { value: string; isGlob: boolean; raw: Word }[] = []
  for (let i = 0; i <= tokens.length; i++) {
    const token = tokens[i]
    if (!token || 'op' in token) {
      runSimple(words, scope, out)
      words = []
      continue
    }
    if ('redirect' in token) {
      const target = tokens[i + 1]
      if (!isWord(target)) continue
      i++
      // >&2, >&- 는 fd 를 잇는 것이다.
      const isFd = token.redirect === '>&' && /^(\d+|-)$/.test(literalOf(target.word))
      if (!isFd && (WRITE_REDIRECTS.has(token.redirect) || token.redirect === '>&')) {
        const { value, isGlob } = expand(target.word, scope)
        const file = fileOf(value, isGlob, scope)
        if (file) out.push(file)
      }
      continue
    }
    words.push({ ...expand(token.word, scope), raw: token.word })
  }
  return out
}
