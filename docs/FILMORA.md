# Filmoraで使うには / Using the exports in Filmora

文字PVメーカーの書き出しを Wondershare Filmora に入れるための案内です。同じファイルは Premiere Pro、DaVinci Resolve、CapCut
でも使えます。English follows the Japanese.

- [日本語](#日本語)
- [English](#english)
- [分かっていること / What we know](#分かっていること--what-we-know)

---

## 日本語

### 書き出し方

1. 手順④「書き出し」の **形式** で **Filmora用** を選びます。
2. 入れるファイルを変えたいときは **詳しく** を開き、**セットに入れるもの** のチェックを変えます。
3. **書き出す** を押します。
   - Chrome・Edge（パソコン）: 保存先のフォルダを選ぶ画面が出ます。選んだフォルダの中に **「作品名_filmora」** というフォルダができ、
     ファイルはすべてそこに入ります（同じ名前のフォルダがあるときは「作品名_filmora (2)」になり、元のフォルダには触れません）。
     ④ の「詳しく」の下と、書き出し後の画面にも、どのフォルダの中にできたかが出ます。
   - フォルダを選べないブラウザ: **「作品名_filmora.zip」** がダウンロードされます。**先に展開**（右クリック →「すべて展開」など）
     してから、中のファイルを使います。
4. 書き出しが終わると、できたファイルの一覧と **Filmoraで使うには ›** が出ます。同じ手順は **README_Filmora.txt** にも
   書いてあります（実際のファイル名・大きさ・フレームレートつき）。

途中で **中止** すると、そのとき作ったフォルダは中身ごと消えます。

### セットの中身

「作品名」は ④ の **ファイル名**（空なら歌詞の `[ti:]` のタイトル、それもなければ `mojipv`）です。

| ファイル | 何か | いつ入るか |
|---|---|---|
| `作品名.mp4` | **完成動画**。H.264・フレームレート固定（24 / 30 / 60fps）・2秒ごとのキーフレーム。音は AAC | いつも |
| `作品名_overlay.webm` | **文字と装飾だけ**の透過動画（WebM、VP9 とアルファ）。自分の映像の上に重ねる用 | 「文字と装飾だけ」（最初からオン） |
| `作品名_bg.mp4` | **背景だけ**の動画。自分の文字や映像をこの上に重ねる用 | 「背景だけ」をオンにしたとき |
| `作品名_green.mp4` | **グリーンバック**の動画（背景が緑 `#00B140`、画質は最高） | 「グリーンバック」をオンにしたとき |
| `作品名.srt` | **字幕**（歌詞の行ごと。UTF-8・BOM付き・CRLF） | 「字幕」（最初からオン） |
| `作品名.lrc` | **時間つき歌詞**（曲の時刻） | 「時間つき歌詞」をオンにしたとき |
| `作品名.wav` | **曲**（PCM 16bit・48kHz・ステレオ、動画とぴったり同じ長さ） | ブラウザが完成動画に曲を入れられないとき（AAC が使えないとき。そのとき完成動画は音なし） |
| `README_Filmora.txt` | **使い方**（日本語と英語） | いつも |

すべての動画は同じ長さ・同じフレームで始まるので、どれも **0:00 にそろえて置く** だけで合います。

### Filmoraでの手順

みんながする手順は次の 2〜3 つだけです。

1. Filmoraで新しいプロジェクトを作り、書き出しと同じ **大きさ・フレームレート** にします（例: 1920×1080・30fps）。
   ④ の注意書き「Filmoraのプロジェクトも …fps・…×… にしてください」に書いてある値です。
2. `作品名.mp4` を読み込み、タイムラインの **0:00** に置きます。
3. `作品名.wav` があるときは、完成動画に音が入っていません。`作品名.wav` を **音声トラックの 0:00** に置きます。

どのファイルも **0:00** にそろえて置けば、曲とぴったり合います。

**必要なときだけ**（完成動画には歌詞も背景ももう入っています。次のファイルは、別の使い方をしたいときのものです）

- 完成動画の代わりに自分の映像の上へ文字だけを重ねるときは、`作品名_overlay.webm` を **上のトラックの 0:00** に置きます
  （透過WebM）。
- 背景だけを使うときは、`作品名_bg.mp4` を **下のトラックの 0:00** に置き、その上に自分の文字や映像を重ねます。
- グリーンバックで重ねるときは、`作品名_green.mp4` を **上のトラックの 0:00** に置き、**クロマキー（緑幕）** をオンにして色
  **#00B140** を選び、許容範囲を少し上げます。
- 歌詞を字幕として別に出したいときだけ、`作品名.srt` を読み込みます（完成動画には歌詞がもう入っているので、両方使うと歌詞が
  二重に出ます）。

### キー色 #00B140

- グリーンバックの背景は **#00B140**（R 0・G 177・B 64）です。
- 数値で入れてうまく抜けないときは、クロマキーの **スポイト** でプレビューの緑の部分を選んでください。動画の色の記録方式
  （BT.601）を読まないソフトでは、同じ緑が少し暗く（おおよそ R 0・G 152・B 61）見えることがあります。
- 文字の縁がにじむときは、許容範囲を少しずつ上げます。

### 確かめること

- [ ] Filmoraのプロジェクトの大きさとフレームレートが、書き出しと同じ。
- [ ] 完成動画の音が出る。出ないときは `作品名.wav` を 0:00 に置く。
- [ ] 透過WebMを重ねたとき、文字の周りが透けて下の映像が見える。
- [ ] すべてのファイルの頭が 0:00 にそろっている。
- [ ] 字幕の日本語が正しく表示される。

### 他の形式

- **MP4**（形式 MP4）: 普通の動画。AAC を書けないブラウザ（Linux の Chrome など）では音が Opus になり、ブラウザ・YouTube・VLC
  では再生できますが、編集ソフトでは音が出ないことがあります。そのときは **Filmora用** で書き出してください。
- **透過動画（WebM）**（その他 ▾）: 背景が透明な動画 1本。Filmora・Premiere・DaVinci・ブラウザで使えます。形式が MP4 のときに
  背景を「透明」にすると、自動でこの形式になります（PNG連番からは透過PNGになります。Filmora用のときは背景に「透明」は
  出ません。セットの「文字と装飾だけ」が透過動画です）。
- **PNG連番 / 透過PNG**（その他 ▾）: 1フレーム 1枚の画像を ZIP にまとめたもの。After Effects などに。Filmoraの「連番として
  読み込む」は JPEG の連番だけという情報があり（未確認）、Filmoraでは透過動画（WebM）のほうが確実です。
- **字幕だけ**: ≡ › ファイル › **字幕（.srt）を保存** で、動画全体の字幕を保存できます。

### うまくいかないとき

- **書き出しが途中で止まったまま進まず、「中止」も効かない**: タブを閉じて開き直し、もう一度書き出してください（作品は自動で
  保存されています）。途中まで書かれたフォルダ（「作品名_filmora (2)」など）は消してかまいません。Linux の Chrome
  （画面を出さないテスト用の起動）で、ときどき起きることが分かっています。Windows・Mac の Chrome・Edge ではまだ
  確かめていません。

---

## English

### Exporting

1. In step ④ Export, set **Format** to **For Filmora**.
2. To change which files go in, open **More** and tick **Files in the set**.
3. Press **Export**.
   - Chrome or Edge on a computer: a folder picker opens. A new folder **"title_filmora"** is made inside the folder you pick,
     and every file goes there (if the name is taken, it becomes "title_filmora (2)"; nothing you already have is touched).
     Step ④ says so under More, and the finished screen names the folder and the one it is in.
   - A browser that cannot pick folders: **"title_filmora.zip"** is downloaded. **Extract it first** (for example,
     right-click → Extract All), then use the files inside.
4. When it is done, step ④ lists the files and shows **How to use in Filmora ›**. The same steps are in
   **README_Filmora.txt** (with the real file names, size and frame rate).

**Cancel** removes the folder the export made, with everything in it.

### What is in the set

"title" is ④'s **File name** (if empty, the lyrics' `[ti:]` title, else `mojipv`).

| File | What it is | When |
|---|---|---|
| `title.mp4` | The **finished video**: H.264, constant frame rate (24 / 30 / 60 fps), a key frame every 2 s, AAC sound | always |
| `title_overlay.webm` | **Words and decorations only**, a transparent video (WebM, VP9 with alpha), to lay over your own footage | "Words and decorations only" (on by default) |
| `title_bg.mp4` | **Background only**, to put your own titles or footage on | when "Background only" is on |
| `title_green.mp4` | **Green screen** (background `#00B140`, highest quality) | when "Green screen" is on |
| `title.srt` | **Subtitles**, one per sung line (UTF-8 with a BOM, CRLF) | "Subtitles" (on by default) |
| `title.lrc` | **Timed lyrics** (song times) | when "Timed lyrics" is on |
| `title.wav` | **The song** (PCM 16-bit, 48 kHz, stereo, exactly as long as the video) | when the browser cannot put the song into the finished video (no AAC; the finished video is then silent) |
| `README_Filmora.txt` | **How to use** (Japanese and English) | always |

Every video has the same length and starts on the same frame: place each one at **0:00** and they line up.

### Steps in Filmora

Everyone does only these two or three steps.

1. Create a new Filmora project with the export's **size and frame rate** (for example 1920×1080, 30 fps) — the values
   step ④ shows in "Set the Filmora project to … fps, …×… too".
2. Import `title.mp4` and place it at **0:00** on the timeline.
3. If there is a `title.wav`, the finished video has no sound: place `title.wav` on an **audio track at 0:00**.

Place every file at **0:00** and it lines up with the song exactly.

**Only when you need them** (the finished video already has the words and the background; these files are for other uses)

- To put only the words over your own footage instead of the finished video, place `title_overlay.webm` on an **upper
  track at 0:00** (transparent WebM).
- To use the background only, place `title_bg.mp4` on a **lower track at 0:00** and put your own titles or footage above it.
- To key out the green screen, place `title_green.mp4` on an **upper track at 0:00**, turn on **Chroma Key** (green screen),
  pick **#00B140** and raise the tolerance a little.
- Only if you want the lyrics as separate subtitles, import `title.srt` (the finished video already shows them; using both
  shows the lyrics twice).

### The key color #00B140

- The green screen's background is **#00B140** (R 0, G 177, B 64).
- If typing the code does not key cleanly, pick the green in the preview with the chroma key's **eyedropper**. Software that
  ignores the video's color tag (BT.601) can show the same green a little darker (about R 0, G 152, B 61).
- If the edges of the words fringe, raise the tolerance step by step.

### What to check

- [ ] The Filmora project's size and frame rate match the export.
- [ ] The finished video has sound. If not, place `title.wav` at 0:00.
- [ ] With the transparent WebM on top, the footage below shows around the words.
- [ ] Every file starts at 0:00.
- [ ] Japanese subtitles show correctly.

### Other formats

- **MP4** (Format MP4): a plain video. A browser that cannot write AAC (for example Chrome on Linux) puts Opus sound in it;
  browsers, YouTube and VLC play it, but an editor may have no sound. Then export **For Filmora**.
- **Transparent video (WebM)** (Other ▾): one video with a transparent background, for Filmora, Premiere, DaVinci and
  browsers. With the format MP4, choosing the background "Transparent" picks this format (from a PNG sequence it picks PNG
  alpha; For Filmora does not offer "Transparent" as a background, as the set's "Words and decorations only" is the
  transparent video).
- **PNG sequence / PNG alpha** (Other ▾): one picture per frame in a ZIP, for After Effects and similar. Filmora's "import as
  image sequence" reportedly takes JPEG sequences only (not verified), so in Filmora the transparent WebM is the safer path.
- **Subtitles only**: ≡ › File › **Save subtitles (.srt)** saves the whole video's subtitles.

### If something goes wrong

- **The export stops moving and Cancel does nothing**: close the tab, open the app again and export again (the project is
  saved automatically). A half-written folder ("title_filmora (2)" and the like) can be deleted. This is known to happen
  now and then in Chrome on Linux (started without a window, as tests do); Chrome and Edge on Windows and Mac have not been
  checked yet.

---

## 分かっていること / What we know

✔ = documented by Filmora or a standard; ? = still to be checked in Filmora itself (Windows 11 and macOS, the current major
version). ✔ = Filmora または規格の資料で確かめたこと、? = Filmora 本体でまだ確かめていないこと。

| # | Finding / 分かっていること | Status | What the app does / アプリの対応 |
|---|---|---|---|
| R1 | MP4 (H.264 video, AAC audio) imports and edits normally / H.264・AAC の MP4 は普通に読み込んで編集できる | ✔ | the set's main video / セットの完成動画 |
| R2 | Transparent video imports as WebM (VP8/VP9 with alpha) or MOV (ProRes 4444); HEVC with alpha does not / 透過動画は WebM（アルファつき VP8/VP9）か MOV（ProRes 4444）。アルファつき HEVC は不可 | ✔ (exact versions ?) | 透過動画（WebM）and the set's overlay are VP9 with alpha; ProRes cannot be made in a browser / 透過動画とセットの文字だけ動画は VP9＋アルファ |
| R3 | "Import as image sequence" reportedly accepts JPEG sequences only / 「連番として読み込む」は JPEG 連番のみとの情報 | ? | PNG sequences are for other editors; the transparent WebM is the Filmora path / PNG連番は他のソフト向け |
| R4 | Built-in chroma key: pick the key color, then adjust the tolerance / クロマキーで色を選び、許容範囲を調整 | ✔ (menu names ?) | green screen at exactly #00B140, quality max / #00B140 のグリーンバック |
| R5 | SRT subtitle files import onto the timeline / SRT 字幕を読み込める | ✔ (BOM and CRLF ?) | SRT as UTF-8 with a BOM and CRLF, the most compatible form / BOM付き UTF-8・CRLF |
| R6 | Opus audio inside MP4 may not import (silent or missing) / MP4 の中の Opus は読み込めないことがある | ? (likely) | the set never uses Opus in MP4: AAC, else the WAV file / セットは AAC か WAV |
| R7 | WAV (PCM 16-bit, 48 kHz) imports / WAV（16bit・48kHz）は読み込める | ✔ | the song as a WAV when AAC is not available / AAC がないときの曲 |
| R8 | The project frame rate should match the clips; an MP4 whose time scale equals its fps reads as exact constant frame rate / プロジェクトとクリップのフレームレートをそろえる | ? | every MP4 has time scale = fps; step ④ and the README name the project settings / ④ と README に設定を表示 |
| R9 | Chrome's video encoder cannot encode alpha directly / Chrome の動画エンコーダーは直接アルファを書けない | ✔ | two VP9 streams (color and alpha) in the app's own WebM writer / 色と透明度を別々に書く |
| R10 | Chrome decodes VP9 alpha in WebM / Chrome は WebM の VP9 アルファを再生できる | ✔ | the tests decode the app's WebM back and compare the alpha / テストで確認 |

The ? rows are the manual checklist of the design (FG10): import every file of a set; the MP4's frame rate, size and sound;
the overlay's transparency over footage; the green screen at #00B140 with clean edges at 1080p; Japanese SRT with and without
the BOM; the WAV at 0:00; whether an Opus MP4's sound imports (R6); a 4K MP4; a PNG sequence (R3); whether Filmora's
color picker reads the green as #00B140 (the BT.601 tag); whether the overlay's alpha shows no trails. Each row is set to ✔ or
✗ when it has been checked, and this guide and the README are corrected if needed.

? の行は設計の手動チェック（FG10）です。Filmora 本体で確かめたら ✔ か ✗ にし、必要ならこの案内と README を直します。
