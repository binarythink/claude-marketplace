import html, re, sys, unicodedata

BASE = ['#1e1e1e', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#dcdfe4',
        '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']

def c256(n):
    if n < 16: return BASE[n]
    if n < 232:
        n -= 16; r, g, b = n // 36, (n // 6) % 6, n % 6
        f = lambda v: 0 if v == 0 else 55 + v * 40
        return '#%02x%02x%02x' % (f(r), f(g), f(b))
    v = 8 + (n - 232) * 10
    return '#%02x%02x%02x' % (v, v, v)

def convert(text):
    st = dict(fg=None, bg=None, bold=False, dim=False, ital=False, ul=False, inv=False)
    out = []
    def span(s):
        if not s: return
        fg, bg = st['fg'], st['bg']
        if st['inv']: fg, bg = (bg or '#1e1e1e'), (fg or '#dcdfe4')
        css = []
        if fg: css.append('color:' + fg)
        if bg: css.append('background:' + bg)
        if st['bold']: css.append('font-weight:bold')
        if st['dim']: css.append('opacity:.6')
        if st['ital']: css.append('font-style:italic')
        if st['ul']: css.append('text-decoration:underline')
        e = ''.join(f'<span class="w">{html.escape(c)}</span>' if unicodedata.east_asian_width(c) in 'WF' else html.escape(c) for c in s)
        out.append(f'<span style="{";".join(css)}">{e}</span>' if css else e)
    pos = 0
    for m in re.finditer(r'\x1b\[([0-9;:]*)([A-Za-z])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]', text):
        span(text[pos:m.start()]); pos = m.end()
        if m.group(2) != 'm': continue
        ps = [int(p) if p else 0 for p in re.split('[;:]', m.group(1) or '0')]
        i = 0
        while i < len(ps):
            p = ps[i]
            if p == 0: st.update(fg=None, bg=None, bold=False, dim=False, ital=False, ul=False, inv=False)
            elif p == 1: st['bold'] = True
            elif p == 2: st['dim'] = True
            elif p == 3: st['ital'] = True
            elif p == 4: st['ul'] = True
            elif p == 7: st['inv'] = True
            elif p == 22: st['bold'] = st['dim'] = False
            elif p == 23: st['ital'] = False
            elif p == 24: st['ul'] = False
            elif p == 27: st['inv'] = False
            elif 30 <= p <= 37: st['fg'] = BASE[p - 30]
            elif 90 <= p <= 97: st['fg'] = BASE[p - 90 + 8]
            elif 40 <= p <= 47: st['bg'] = BASE[p - 40]
            elif 100 <= p <= 107: st['bg'] = BASE[p - 100 + 8]
            elif p == 39: st['fg'] = None
            elif p == 49: st['bg'] = None
            elif p in (38, 48):
                key = 'fg' if p == 38 else 'bg'
                if i + 1 < len(ps) and ps[i + 1] == 5 and i + 2 < len(ps):
                    st[key] = c256(ps[i + 2]); i += 2
                elif i + 1 < len(ps) and ps[i + 1] == 2 and i + 4 < len(ps):
                    st[key] = '#%02x%02x%02x' % tuple(ps[i + 2:i + 5]); i += 4
            i += 1
    span(text[pos:])
    return ''.join(out)

src, dst, title = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open(src, encoding='utf-8').read()
lines = [l.rstrip() for l in raw.split('\n')]
while lines and not re.sub(r'\x1b\[[0-9;:]*m', '', lines[-1]).strip(): lines.pop()
while lines and not re.sub(r'\x1b\[[0-9;:]*m', '', lines[0]).strip(): lines.pop(0)
body = '\n'.join(convert(l) for l in lines)
open(dst, 'w', encoding='utf-8').write(f'''<!doctype html><meta charset="utf-8"><style>
body{{margin:0;background:#1e1e1e}}
.win{{display:inline-block;margin:16px;border-radius:8px;background:#1e1e1e;box-shadow:0 0 0 1px #3a3a3a}}
.bar{{padding:8px 12px;color:#9da5b4;font:13px -apple-system,sans-serif;border-bottom:1px solid #3a3a3a}}
pre{{margin:0;padding:12px 16px;color:#dcdfe4;font:14px/1.35 "D2KodingLigature Nerd Font","JetBrainsMono NF","Menlo",monospace;white-space:pre}}
.w{{display:inline-block;width:2ch;text-align:center}}
</style><div class="win"><div class="bar">{html.escape(title)}</div><pre>{body}</pre></div>''')
