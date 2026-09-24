# 文字PVメーカー（仮）

歌詞と曲から、文字PV（リリックモーション）を作るブラウザアプリです。

**▶ ブラウザで使う：<https://momomonbi.github.io/moji-pv/>**（English：<https://momomonbi.github.io/moji-pv/en/>）

- インストールは要りません。歌詞・曲・書き出しは、すべてブラウザの中で処理します。
- AI を使わなくても、すべての機能が使えます。

## できること

707の部品と24のスタイルを組み合わせて、カットを自動で組み立て、MP4 に書き出します。画面の「記法」で歌詞の書き方を、右上の「利用について」で権利とライセンスを確認できます。

そのうえで、AI アシストを足しています。

| 機能 | すること |
|---|---|
| 歌詞の下ごしらえ | 歌詞ではない行（作詞のクレジットや [Verse] など）を除く候補、カットの区切り、強調する語、特別な読みを提案します |
| AI 演出3案 | 歌詞の意味から、スタイル・配色・動き・サビの見せ方を3案作ります。季節に合わないモチーフ（夏の歌に雪など）は使いません |
| ひとこと修正 | 「サビをもっと派手に」のような一文を変更案にします |
| 曲を使う（Gemini だけ・試験的） | 曲から歌詞を書き起こす、歌詞のタイミングを曲に合わせる、曲を分析する（サビの位置・雰囲気・テンポ） |

どの機能も、変更の一覧を見せてから反映します。反映したあとも「AI の変更を元に戻す」で戻せます。
くわしい使い方は [docs/AI_GUIDE.md](docs/AI_GUIDE.md) にあります。

## AI アシストの使い方

1. 右上の「AI」を押します（かんたんモードでは「AI に演出を3案もらう」でも開きます）。
2. 「使う AI と API キー」で、AI サービスを選び、API キーを貼り付けます。貼り付けるとすぐに、キーが使えるかを確かめます（料金はかかりません）。
   - 既定は Google Gemini の **gemini-3.8-flash** です。キーは [Google AI Studio](https://aistudio.google.com/apikey) で作れます。
3. 使いたい機能のボタンを押します。出てきた変更のうち、使うものにチェックを入れて反映します。

### 送るものと、キーの扱い

- 送るのは、歌詞のテキスト、ひとこと修正の文、設定の数値です。
- 曲の音声は、「曲を使う」のボタンを、同意のチェックを入れて押したときだけ、Google Gemini に送ります。
- ブラウザから、選んだ AI サービスへ直接送ります。ほかのサーバーは通りません。
- キーは、このブラウザにだけ保存します。ふだんはタブを閉じると消えます。「この端末に記憶する」をオンにしたときだけ残ります。共用の PC ではオンにしないでください。
- キーは、プロジェクトのファイル（.json）には入りません。
- 利用料は、選んだ AI サービスから請求されます。1回ごとに、使ったトークン数と金額の目安を画面に出します。

1曲の目安（40行、下ごしらえ1回・3案1回・ひとこと修正3回、1ドル150円）：gemini-3.8-flash で約10円。詳しくは [docs/MEASUREMENTS.md](docs/MEASUREMENTS.md)。

## 動作環境

- MP4 の書き出しには、WebCodecs に対応したブラウザが要ります。PC の Chrome / Edge をすすめます。
- フォントは Google Fonts から、使う書体だけを読み込みます。

## 開発

```
python3 build.py                # src/ app/ vendor/ → index.html と en/index.html
node dev/snapshot_test.js       # 歌詞の解析・タイミング・構成のスナップショット試験（--update で更新）
node dev/ai_test.js             # AI の中核の試験（通信は偽物。キー不要）
(cd dev && npm ci) && python3 dev/check_english.py   # 英語の用語表が画面の文言を網羅しているか
node dev/diversity.js           # 表現の多様さ（基準値は docs/diversity_baseline.json）
```

ブラウザを使う試験は、Playwright（Python）で動きます。`PW_CHANNEL=chrome` で PC の Chrome を使います。

```
python3 dev/build_test.py all --all-packs && (cd dev/www && python3 -m http.server 8765 &)
python3 dev/smoke_all.py        # 707部品を描いて、エラーがないか
python3 dev/csp_check.py        # CSP の違反が0件か、フォントを読み込めるか
python3 dev/ai_ui_check.py      # AI パネルを通しで操作（Gemini の応答は差し替え）
python3 dev/ai_probe.py         # 実際の API に、ダミーのキーで CORS を確かめる
```

どれも GitHub Actions（`.github/workflows/ci.yml`）で動きます。

- SDK は `vendor/ai-sdk.min.js` に同梱しています。作り直すときは `cd tools/vendor && npm ci && npm run build`。
- ページには CSP を入れています。スクリプトはハッシュで許可しているので、index.html を手で直さず、必ず `build.py` で作り直してください。
- アプリ名と公開先は `build.py` の先頭にまとめています。

## ライセンス

[MIT License](LICENSE)。
同梱しているサードパーティのソフトウェアは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を見てください。

このツールで作った動画や画像の権利は、作った人（と、その歌詞・曲の権利者）にあります。
