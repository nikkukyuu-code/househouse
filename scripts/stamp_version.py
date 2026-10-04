#!/usr/bin/env python3
"""Publish stamp: GAME_VERSION / GAME_VERSION_BUST / GAME_BUILD_TIME (Asia/Tokyo), every ?v= cache-bust,
the auto-update PAGE_LABEL in the pages, and version.json (polled by the pages to auto-reload at a safe moment)."""
import re, time, pathlib, datetime, sys
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import autoupdate as au
ms = int(time.time() * 1000)
jst = datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone(datetime.timedelta(hours=9)))
v = jst.strftime('%Y%m%d%H%M%S'); label = jst.strftime('%Y-%m-%d %H:%M:%S')
g = ROOT / 'game/js/game.js'; t = g.read_text()
t = re.sub(r"GAME_VERSION = '[^']*'", f"GAME_VERSION = '{label}'", t)
t = re.sub(r"GAME_VERSION_BUST = '[^']*'", f"GAME_VERSION_BUST = '{v}'", t)
t = re.sub(r"GAME_BUILD_TIME = \d+", f"GAME_BUILD_TIME = {ms}", t)
g.write_text(t)
for p in list((ROOT / 'game').rglob('*.js')) + list((ROOT / 'game').rglob('*.html')) + [ROOT / 'index.html']:
    s = p.read_text(); s2 = re.sub(r'\?v=\d{14}', f'?v={v}', s)
    if s2 != s: p.write_text(s2)
for p in [ROOT / 'index.html', ROOT / 'game/index.html']: au.set_label(p, label)
au.write_json(ROOT / 'version.json', label, ms)
print(ms, v, label)
