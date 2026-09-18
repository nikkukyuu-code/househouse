# ハウスと罠

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

## 遊び方（要点）

- **オンライン:** ルームコードは **6桁の数字**（例: `123456`）
- **罠:** 通常罠と落とし穴（落とし穴はダメージ＋下の階へ落下）を合わせて最大5個
- **秘密:** 自分の家の宝箱・罠は上画面で見える。探索中の相手の家では未発動の罠・宝箱は見えない

## 更新

`game/` 内を編集して `main` に push すると GitHub Pages に反映されます。
