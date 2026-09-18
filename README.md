# ハウスハウス

スマホ向けの2人対戦探索ゲームです。

- **説明ページ（フォルダ構成）:** https://nikkukyuu-code.github.io/househouse/
- **プレイ:** https://nikkukyuu-code.github.io/househouse/game/

## フォルダ構成

```
/
├── index.html          # 説明ページ（構成・置き場所）
├── README.md
└── game/               # ゲーム本体
    ├── index.html
    ├── css/style.css
    └── js/
        ├── game.js
        ├── house.js
        ├── net.js
        └── ui.js
```

ゲームファイルはすべて `game/` 以下に置きます。ルートの `index.html` は説明のみです。

## 更新

`game/` 内を編集して `main` に push すると GitHub Pages に反映されます。
