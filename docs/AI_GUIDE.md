# AI アシストの使い方

文字PVメーカーの AI アシストの説明書です。AI は「おまけ」で、使わなくてもアプリのほかの機能はすべて使えます。
（English version: [below](#ai-assist-guide-english)）

AI アシストは、詳細の欄の **「AI」タブ** にまとまっています。手順の欄のボタンからも開けます。

| ボタン | 場所 | 開くもの |
|---|---|---|
| AIで整える | ① 歌詞 | 歌詞の下ごしらえ |
| AIでタイミング | ② 曲（曲を読み込んだとき） | 曲を使う › タイミングを合わせる |
| AIに3案 | ③ 見た目 | 演出を3案もらう |

どのボタンも、AI タブの該当する道具を開くだけです。押しただけで送ることはありません。
AI タブが見えないときは、≡ › 設定 › 「AIを使う」をオンにしてください。

## 1. キーを用意する（AIとの接続）

AI タブのいちばん上が「AIとの接続」です。

1. **サービス** を選びます。既定は **Google Gemini**、モデルは **gemini-3.8-flash** です。もう一つのサービス（ここでは「サービスB」と呼びます）も選べます。
2. **キーを作る ↗** で、選んだサービスのキーのページが開きます。Gemini なら [Google AI Studio](https://aistudio.google.com/apikey) です。
3. 作ったキーを **APIキー** の欄に貼り付けます。形がおかしいと「{サービス} のキーはふつう「…」で始まります」と教えてくれます。
4. **確認** を押します。「使えます」と出れば準備完了で、カードは1行にたたまれます（「変更」でまた開けます）。
   - 確認は無料です（モデルの情報を読むだけです）。
   - 状態の表示: 未設定 / 形が違うかも / キーが入っています（未確認） / 確認中… / 使えます / キーが違います / このモデルは使えません / 通信できません

**この端末に記憶する（共用のPCではオフに）**: オフのとき、キーはこのタブの中だけに置かれ、タブを閉じると消えます。
オンにすると、このブラウザに残ります。**キーを消す** でいつでも消せます。

使うには自分の API キーが必要で、料金はキーの持ち主に請求されます。

## 2. 歌詞の下ごしらえ

歌詞サイトなどから貼った歌詞を、文字PV向けに整える提案をします。

| 提案すること | 例 |
|---|---|
| 歌詞でない行を外す | 「作詞：〇〇」「［サビ］」「×2」 |
| 区切り（カットの分け目） | 「夜明けの色を覚えてる」→「夜明けの色を / 覚えてる」 |
| 強調 | 意味の中心の語を `*強調*` に |
| 読み | 当て字の読みを `\|注釈` として添える |

歌詞の言葉そのものは変えません。変えずには書けない提案は「歌詞の言葉を変えずには書けない変更です」として外されます。
手で固定した区切りや、ロックした行はそのままです。

## 3. 演出を3案もらう

歌詞の意味と季節を読み取り、見た目の案を3つ出します。

- 案ごとに、タイトル・考え方・配色・変更の数が出ます。「歌詞のテーマ」「季節」も表示されます。
- **試写**: 反映する前に、プレビューでその案を再生します。「案Bを試写中 [反映する] [やめる]」と表示されます。
  試写中に **B** キーを押しているあいだは、いまの見た目が見えます。何かを編集すると試写は終わります。
- **変更を見る** で中身を確かめ、**この案にする** で反映します。
- 季節に合わない部品（夏の歌に雪など）は使いません。「曲を分析する」で保存した分析があれば、サビの位置も使います。

## 4. ひとこと修正

一言で頼むと、変更の一覧を作ります（300文字まで。Enter で送る、Shift+Enter で改行）。

- **対象**: 作品全体 / 選択中の行（行を選ぶと、その行だけに頼めます）
- 例: 「サビをもっと派手に」「全体を落ち着いた雰囲気に」「配色を夏っぽく」「乱れを減らして」「桜の装飾は使わないで」
- 意味があいまいなときは、何も変えずに聞き返します（「AIからの質問: …」）。
  伝わらなかったときは「指示がうまく伝わりませんでした。言い方を変えて試してください。」と出ます。

## 5. 曲を使う（Google Gemini のみ）

② 曲 で曲を読み込み、サービスが Google Gemini のときに使えます。まず同意のカードが出ます。

> 曲の音声を 16kHz モノラルにして Google Gemini に送ります（約 7MB・3:42）。この作品ではこのときだけ。

**この内容で送ることに同意する** にチェックを入れると、3つのボタンが使えます。

| ボタン | すること | 結果 |
|---|---|---|
| 書き起こす | 歌っている歌詞を聞き取ります | 「置き換える」か「後ろに足す」を選びます。「時刻をつける」で行頭に `[分:秒]` が入ります |
| タイミングを合わせる | 入力済みの歌詞の各行が、曲のどこで始まるかを探します | 行の開始時刻の変更として一覧に出ます（LRC の時刻より優先されます） |
| 曲を分析する | 雰囲気・テンポ・曲の構成（イントロ・サビなど）・聴きどころを調べます | 「保存する」で作品に保存し、あとの提案に使います |

- 同意は、いま開いている作品についてだけ有効です。別の作品を開いたり、ページを読み込み直したりすると、もう一度たずねます。
- 音声はモノラルの WAV にして送ります。ふつうは 16 kHz（約7分まで）、長い曲は 12 kHz や 8 kHz（約14分まで）に下げて1回で送ります。それより長い曲は 16 kHz のままアップロードしてから使います。送る大きさと長さは、同意のカードに出ます。
- 送ってよい曲（自分の曲や、権利者の許可がある曲）だけに使ってください。公開されている歌詞と判断されると書き起こせません。そのときは歌詞を貼って「タイミングを合わせる」を使ってください。
- 時刻は目安です。ずれていたら、詳細やタップ合わせで直してください。
- サービスBでは、曲の音声は送れません（「Google Gemini のときだけ使えます」）。

## 6. 結果の確かめ方と取り消し

どの道具も、まず **チェック付きの一覧**（歌詞 / 全体 / 行ごと / 時間）で結果を見せます。この時点では「まだ何も変わっていません。反映するものを選んでください。」と出ていて、作品はまだ変わっていません。

- 各行に「変更前 → 変更後」と理由が出ます。**すべて** / **なし** でまとめてチェックできます。
- 頼んだあとで変わった項目には「この後に変更あり」が付き、チェックが外れます。入れ直せば反映できます。
- 使えなかった提案は「使えなかった提案 n件」にまとまります。
- **選んだ n 件を反映** で反映、**捨てる** で何も変えずに閉じます。一覧が開いているあいだ、「詳細」タブは使えません。
- 反映は「元に戻す」1回で取り消せます。
- **反映した AI の変更** に記録が残り、あとからでも **元に戻す** で、その回の変更のうち後で手を入れていないものだけを戻せます。
- AI が決めた値は「AIで固定」と表示されます。「AIが決めた固定 n」の **すべて自動に戻す** でまとめて自動に戻せます。

## 7. 送るものと保存されるもの

**送るもの**: 歌詞のテキスト・指示・設定の数値（テーマ・雰囲気・部品の名前など）。
曲の音声は、「曲を使う」で同意したときだけ Google Gemini に送ります。

**送り先**: 選んだ AI サービスだけです。ブラウザから直接送り、ほかのサーバーは通りません。

**保存されるもの**

| もの | 場所 |
|---|---|
| APIキー | このブラウザだけ（ふだんはタブの中、「この端末に記憶する」ならブラウザに）。作品ファイルには入りません |
| サービス・モデル・記憶するかどうか | このブラウザ |
| 反映した変更・AI の記録・保存した曲の分析 | 作品の中（ふつうの設定と同じ） |
| AI に送った音声（WAV）・同意 | 保存しません（読み込んだ曲そのものは、ふつうどおりこのブラウザに保存されます） |

≡ › 設定 › 「この端末に保存した作品と曲を消す」は、保存した AI のキーも消します。

## 8. 料金の表示

料金は、キーの持ち主に AI サービスから請求されます。一覧の下に、その回の量と金額の目安が出ます。

> 入力 3,210 / 出力 850 トークン · 約 $0.0056

- 金額は米ドルで表示します。
- gemini-3.8-flash の目安は、100万トークンあたり入力 $0.75 / 出力 $3.75 で計算しています（2026年12月31日までの価格です。その後は $1.50 / $7.50 になる予定なので、実際の請求は表示の約2倍になります）。
- 単価の分からないモデルでは、トークン数だけを表示します。
- キーの確認は無料です。

## 9. うまくいかないとき

画面に出る文のとおりに並べています。

| 表示 | すること |
|---|---|
| APIキーを入れてください。 | AIとの接続にキーを貼ります |
| キーが使えません。キーを確かめてください。 | キーを貼り直して「確認」を押します |
| このモデルは使えません。別のモデルを選んでください。 | 「モデル」を変えます |
| 回数の上限に達しました。少し待ってから試してください。 | 少し待ってからやり直します |
| サービス側で問題が起きています。時間をおいて試してください。 | 時間をおいてやり直します |
| 送った内容が受け付けられませんでした。 | 歌詞や指示を短くして試します |
| 通信できませんでした。接続を確かめてください。 | ネットワークを確かめます |
| 中止しました。 | 「中止」を押したときに出ます |
| 安全のため答えが止められました。 | 別の頼み方にするか、手で調整します |
| 公開されている歌詞と判断され、書き起こせませんでした。… | 歌詞を貼り、「タイミングを合わせる」を使います |
| 答えが途中で切れました。行を減らして試してください。 | 行を選んで範囲をしぼります |
| 答えが空でした。もう一度試してください。 / 答えを読み取れませんでした。もう一度試してください。 | もう一度押します |
| 必要な部品が読み込まれていません。 | ページを読み込み直します |
| このサービスには曲を送れません。Gemini を選んでください。 | サービスを Google Gemini にします |
| 曲のアップロードに失敗しました。 | もう一度試します。長い曲は時間がかかります |
| 歌詞の行が合わないため反映できません。 | 歌詞が変わりました。もう一度頼みます |
| AIの答えをうまく処理できませんでした。もう一度試してください。 | もう一度押します |

ボタンが押せないときは、理由がボタンの近くに出ます（「キーを入れると使えます」「歌詞を入れると使えます」
「曲を読み込むと使えます」「上の内容に同意すると使えます」「いまの提案を反映するか捨てると使えます」など）。

## 10. AI がしないこと

- 確かめずに変えること。どの結果も一覧を見せ、選んだものだけを反映します。
- 歌詞の言葉を書き換えること（書き起こしを「置き換える」「後ろに足す」で選んだときを除く）。
- ロックした行の見た目や、手で固定した値を変えること。
- 使わないことにした部品や、季節に合わない部品を使うこと。
- 同意なしに曲を送ること。サービスBに曲を送ること。
- キーを作品ファイルに書くこと、選んだサービス以外に送ること。
- 自分から動き出すこと。ボタンを押したときだけ送ります。

---

## AI assist guide (English)

AI assist is optional: every other feature works without it. It lives in the **AI** tab of the detail column. The
buttons **AI tidy-up** (step 1), **AI timing** (step 2, with a song) and **Ask AI: 3 looks** (step 3) open the matching
tool there; they never send anything by themselves. If the tab is missing, turn on ≡ › Settings › **Use AI**.

### Key setup and check

1. Pick a **Service**: **Google Gemini** (default, model **gemini-3.8-flash**) or the second AI service.
2. **Get a key ↗** opens the key page of that service (Gemini: [Google AI Studio](https://aistudio.google.com/apikey)).
3. Paste it under **API key** and press **Check** — free, it only reads the model information. States: Not set / This
   may not be a key / Key entered (not checked) / Checking… / Ready / Wrong key / This model is not available / Cannot
   connect.
4. **Remember on this device (turn off on a shared computer)**: off keeps the key in this tab only; on keeps it in this
   browser. **Remove the key** deletes it. Usage is billed to the key's owner.

### The tools

- **Prepare lyrics** — removes lines that are not lyrics (credits, [Chorus] …) and suggests cut points (`/`), emphasis
  (`*word*`) and readings (`|note`). The words themselves never change; hand-set cut points and locked lines stay.
- **Get 3 looks** — three looks that fit the meaning and the season of the lyrics. **Try on** plays a look in the preview
  ("Trying on look B" with **Apply** / **Stop**; hold **B** to see the current look); **Use this look** applies it.
- **One-line edit** — up to 300 characters, for the **Whole video** or the **Selected line(s)**. If the request is
  unclear, the AI asks back ("The AI asks: …") instead of guessing.
- **Use the song** (Google Gemini only) — after the consent card ("The song's audio will be sent to Google Gemini as
  16 kHz mono (about 7 MB, 3:42), this time only.") and **I agree to send it as described**: **Transcribe** (then
  **Replace** or **Add after**, optionally **Include the times**), **Match timing** (new line start times, which override
  LRC times) and **Analyze the song** (mood, tempo, sections, highlights; **Save** keeps it for later suggestions).
  Consent covers the open project only and is asked again after opening another project or reloading. Audio goes as mono
  WAV: 16 kHz up to about 7 min, 12 or 8 kHz up to about 14 min, longer songs at 16 kHz through an upload; the consent
  card shows the size and length. Only send songs you may send; published lyrics cannot be transcribed —
  paste them and use Match timing.

### Review, apply, revert

Every result first appears as a checked list (Lyrics / Whole video / Per line / Timing) with before → after and a
reason. Rows that changed after the request are unchecked and marked **Changed since**. **Apply the n selected changes**
or **Discard**; one undo takes an apply back. **AI changes applied** keeps a log: **Revert** undoes the changes of one run
that were not edited later. Values chosen by the AI show **Set by AI**; **Set all back to auto** clears them.

### What is sent and stored

Sent: the lyric text, your instruction and setting values — directly from the browser to the service you chose. Audio
only through **Use the song**, after consent, to Google Gemini. Stored: the key in this tab or browser (never in project
files); the service/model choice in this browser; applied changes, the AI log and a saved song analysis in the project.
The WAV sent to the AI and the consent are not stored (the loaded song itself is kept in this browser as usual). ≡ › Settings › **Delete works and songs saved on this device** also removes
stored AI keys.

### Cost

Each result shows e.g. "3,210 input / 850 output tokens · about $0.0056" (USD). For gemini-3.8-flash the estimate uses
$0.75 input / $3.75 output per 1M tokens, the price until 2026-12-31; after that the price is planned to be $1.50 / $7.50,
so the actual bill will be about twice the estimate. Models without a known price show the token counts only.

### Troubleshooting (messages as the app shows them)

| Message | What to do |
|---|---|
| Please enter an API key. | Paste a key under Connection |
| This key does not work. Please check it. | Paste it again and press Check |
| This model is not available. Choose another one. | Pick another model |
| Rate limit reached. Wait a moment and try again. | Wait, then retry |
| The service has a problem. Try again later. | Retry later |
| The request was not accepted. | Try shorter lyrics or a shorter instruction |
| Could not connect. Please check your connection. | Check the network |
| Stopped. | Shown after **Stop** |
| The answer was blocked by a safety filter. | Ask differently, or adjust by hand |
| The song was recognized as published lyrics, so it could not be transcribed. … | Paste the lyrics and use Match timing |
| The answer was cut off. Try with fewer lines. | Select fewer lines |
| The answer was empty. Please try again. / The answer could not be read. Please try again. | Retry |
| A required component did not load. | Reload the page |
| This service cannot take audio. Please choose Gemini. | Switch the service to Google Gemini |
| Uploading the song failed. | Retry; long songs take a while |
| The lyric lines do not match, so the change cannot be applied. | The lyrics changed; ask again |
| The AI answer could not be handled. Please try again. | Retry |

A disabled button says why next to it ("Enter a key to use this", "Add lyrics to use this", "Load a song to use this",
"Agree to the note above to use this", "Apply or discard the current suggestions first" …).

### What the AI never does

It never changes anything without the review list; never rewrites the lyric words (except a transcript you choose to
use); never touches locked lines or values you pinned by hand; never uses parts you turned off or parts of another
season; never sends audio without consent, and never to the second AI service; never writes the key into a project
file or sends it anywhere but the chosen service; and never runs on its own.
