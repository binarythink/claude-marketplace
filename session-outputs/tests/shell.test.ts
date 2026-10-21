import { describe, expect, test } from 'claude-code/testing'

import { writtenFiles } from '../hooks/shell'

const HOME = '/Users/me'
const at = (command: string, cwd = '/r') => writtenFiles(command, { cwd, home: HOME })
const paths = (command: string, cwd = '/r') => at(command, cwd).map(one => one.path)

describe('writtenFiles', () => {
  test('follows variables through a backup, heredoc append and in-place edit', () => {
    // herdr 설정을 고친 세션에서 실제로 보낸 명령들
    const command = [
      'f=~/.config/herdr/config.toml; cp "$f" "$f.bak.$(date +%Y%m%d-%H%M%S)"; cat >> "$f" <<\'EOF\'',
      '',
      '# space 순환 > 2 > out.txt',
      'previous_workspace = "alt+shift+k"',
      'EOF',
      'tail -8 "$f"; herdr --help 2>&1 | grep -i -E "config|check|reload" | head',
    ].join('\n')
    expect(at(command)).toEqual([
      { path: `${HOME}/.config/herdr/config.toml.bak.*`, namePattern: '^config\\.toml\\.bak\\..+$' },
      { path: `${HOME}/.config/herdr/config.toml` },
    ])
    expect(paths('f="/m/topics/vooster.md"; sed -i \'\' \'s/^a: .*/a: 1/\' "$f"; cat "$f" | grep a'))
      .toEqual(['/m/topics/vooster.md'])
    expect(paths('sed -i \'\' \'s/x/y/\' ~/.config/herdr/config.toml && grep -n topic ~/.config/herdr/config.toml'))
      .toEqual([`${HOME}/.config/herdr/config.toml`])
  })

  test('reads redirects but not fd duplication, /dev or input', () => {
    expect(paths('echo "a > b" > out.txt 2>>err.log >/dev/null 2>&1 < in.txt; echo x &> all.log'))
      .toEqual(['/r/out.txt', '/r/err.log', '/r/all.log'])
    expect(paths("echo '>' quoted; echo x>|forced.txt")).toEqual(['/r/forced.txt'])
    expect(paths('cat <<EOF > made.md\nline > not-a-file\nEOF\n')).toEqual(['/r/made.md'])
  })

  test('sed and perl in-place targets in GNU and BSD forms', () => {
    expect(paths("sed -i 's/a/b/' a.txt b.txt")).toEqual(['/r/a.txt', '/r/b.txt'])
    expect(paths("sed -i.bak -e 's/a/b/' -e 's/c/d/' c.txt")).toEqual(['/r/c.txt'])
    expect(paths("sed -i .orig 's/a/b/' d.txt")).toEqual(['/r/d.txt'])
    expect(paths("sed -E -n 's/a/b/p' e.txt > f.txt")).toEqual(['/r/f.txt'])
    expect(paths("perl -pi -e 's/a/b/' g.txt")).toEqual(['/r/g.txt'])
  })

  test('cp, mv, install, tee, touch, curl and dd destinations', () => {
    expect(at('cp src/a.ts dist')).toEqual([{ path: '/r/dist', intoDirName: 'a.ts' }])
    expect(paths('cp -r a.ts b.ts out/')).toEqual(['/r/out/a.ts', '/r/out/b.ts'])
    expect(paths('mv -t /x a.ts ../b.ts')).toEqual(['/x/a.ts', '/x/b.ts'])
    expect(paths('install -m 644 a.conf /etc/x/a.conf; install -d /etc/y')).toEqual(['/etc/x/a.conf'])
    expect(paths('git diff | tee -a p.patch q.patch | wc -l')).toEqual(['/r/p.patch', '/r/q.patch'])
    expect(paths('touch -t 202601010000 t.txt')).toEqual(['/r/t.txt'])
    expect(paths('curl -sSLo dl.zip https://x.io/a && curl --output=b.bin https://x.io/b')).toEqual(['/r/dl.zip', '/r/b.bin'])
    expect(paths('dd if=/dev/zero of=img.bin bs=1 count=1')).toEqual(['/r/img.bin'])
  })

  test('follows cd, wrappers and sh -c, and drops what it cannot know', () => {
    expect(paths('cd sub && echo x > a.txt; cd ..; echo y > b.txt')).toEqual(['/r/sub/a.txt', '/r/b.txt'])
    expect(paths('sudo tee /etc/hosts < h; bash -c "echo x > c.txt"')).toEqual(['/etc/hosts', '/r/c.txt'])
    expect(paths('echo x > "$OUT"; echo x > *.log; echo x > $(mktemp)/a; cd "$D" && echo x > a.txt')).toEqual([])
    expect(writtenFiles('echo x > a.txt > /abs.txt', { home: HOME })).toEqual([{ path: '/abs.txt' }])
    expect(paths('echo x > "$HOME/a.txt"; export D=/d; echo x > "${D}/b.txt"')).toEqual([`${HOME}/a.txt`, '/d/b.txt'])
    expect(paths('grep -r foo . | head; git log --oneline > /dev/null')).toEqual([])
  })
})
