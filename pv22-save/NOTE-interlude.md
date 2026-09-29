# 間奏演出（PV22 とは別に main へ入れた変更）

- 2026-09-29: 間奏の「─♪─」（breathMark）を自動では使わなくし、3つの演出を `src/parts/arrange/interlude.js` に追加した。
  `lightMotes`（光の粒）、`soundHorizon`（音の水平線）、`kineticShapes`（図形の舞）。今ある作品も含め、すべての作品の
  間奏が対象（オーナー決定）。breathMark は `pool: false`（ピンでのみ使う）。
- main へは PR #14 を squash マージで入れた。PV22 の履歴は main に入れていない。PV22 の保存は、この指定ブランチの
  「更新」マージ（親に 2bcb147 とこの記録）で引き続き到達できる。

## PV22 再開時の注意

1. 各パッケージ（p1〜p6、pv22）に新しい main をマージする。部品が増えて registry version が変わったので、plan_hashes と
   PV22 側のゴールデン（project_kumi、project_pv、project_glyph、project_sung など）を作り直す。
2. ぶつかりやすいファイル: `src/ui/fields.js`（表示する文字の行は間の印のときだけ）、`src/i18n/strings.js`
   （`opt.moteFlow.*`）、`src/core/registry.js`（`filterFor` を追加）、`src/planner/cast.js`（`filterAllows` と
   `pinWarnings` にカットの役割）、`src/planner/explain.js`、`src/ui/part_browser.js`、`src/ui/inspector.js`、
   `src/ui/palette.js`（`pinnable`）、`tests/node/arrange_dwell.test.js`（MODULES、24 行、スキップの規則）、
   `docs/DESIGN.md` §5 と §5.1、`docs/DESIGN_2_1.md` §9、`docs/NOTES.md`（追記のみ）、`tests/browser/perf.py`（lrc は 30 秒から）。
3. `frame_hashes_v2.json` の lrc 21–32 と 34–37 は意図して書き換え済み（`--v2`）。PV22 の変更で間奏のコマが動いたら、
   間奏の見た目の変更かどうかを確かめる。
4. 間奏演出は新しい作品の印（look.gen）を使っていない。PV22 で look.gen を入れるときは GEN = 1 のままでよい。

## 訂正（2026-09-29、マージ後）

PR #14 は squash ではなく通常のマージ（eeec170）で main に入った。そのため main の履歴には、保存用マージ 60967d7 を
通じて PV22 の全コミット（p1〜p6、pv22、この記録）が「祖先」として入っているが、中身（変更）は main に入っていない。

- 上の「1. 各パッケージに新しい main をマージする」は **してはいけない**。main はパッケージを祖先に持つので、
  パッケージへ main をマージすると早送り（fast-forward）になり、パッケージの変更が消える。逆にパッケージを main へ
  マージしても「Already up to date」で何も入らない。
- 再開の手順: 新しい main から作業ブランチを作り、各パッケージの変更を載せ直す。
  `git checkout -b p1-re origin/main && git cherry-pick 9a9e950..p1`（p2〜p6、pv22 も同じ。p6 は p5 を含む点に注意）。
  または `git diff 9a9e950 p1 | git apply --3way`。そのあとゴールデンと plan_hashes を作り直す。
- 保存について: PV22 の作業はすべて main の履歴から辿れるので、消える心配はない。
