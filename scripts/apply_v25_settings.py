# -*- coding: utf-8 -*-
"""v2.5 для settings-dialog.tsx: убрать секцию «Активация голосом»."""
import re, sys

S = 'src/components/daria/settings-dialog.tsx'
s = open(S, encoding='utf-8').read()

def sub_s(pat, repl, n_expected=1):
    global s
    new, n = re.subn(pat, lambda m: repl, s)
    if n != n_expected:
        print(f'FAIL(settings): {pat[:70]!r} -> {n}')
        sys.exit(1)
    s = new

sub_s(r"import \{ AudioLines, Brain, Globe, Mic, Sparkles, Trash2, Volume2, VolumeX \} from 'lucide-react'",
      "import { AudioLines, Brain, Globe, Sparkles, Trash2, Volume2, VolumeX } from 'lucide-react'")
sub_s(r"  /\*\* Имя активации \(id из WAKE_OPTIONS ниже\) \*/\n"
      r"  wakeWordId: string\n"
      r"  onWakeChange: \(id: string\) => void\n", "")
sub_s(r"/\*\* Имена активации: id совпадают с WAKE_WORDS в page\.tsx \*/\n"
      r"const WAKE_OPTIONS = \[[\s\S]*?\] as const\n\n", "")
sub_s(r"  wakeWordId,\n  onWakeChange,\n", "")
sub_s(r"        \{/\* Активация голосом: имя, на которое просыпается ассистент \*/\}\n[\s\S]*?        \{/\* Переключатели \*/\}",
      "        {/* Переключатели */}")
sub_s(r"Дария · интерфейс v2\.4 · сборка 14:10", "Дария · интерфейс v2.5 · сборка 14:33")

open(S, 'w', encoding='utf-8').write(s)
print('settings-dialog.tsx: все замены применены')
