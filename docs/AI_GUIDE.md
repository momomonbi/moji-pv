# AI アシストの使い方

文字PVメーカーの AI アシストの説明書です。AI は「おまけ」で、使わなくてもアプリのほかの機能はすべて使えます。
（English version: [below](#ai-assist-guide-english)）

AI アシストは、詳細の欄の **「AI」タブ** にまとまっています。ほかの場所のボタンからも開けます。

| ボタン | 場所 | 開くもの |
|---|---|---|
| AIで整える | ① 歌詞 | 歌詞の下ごしらえ |
| AIでタイミング | ② 曲（曲を読み込んだとき） | 曲を使う › タイミングを合わせる |
| AIに3案 | ③ 見た目 | 演出を3案もらう |
| この行をAIに頼む… / この区画をAIに頼む… / このカットをAIに頼む… | 詳細の、行・区画・カットのページ | 指示（その行・区画・カットを選んだ状態で） |
| ＋ AIで作る | 部品を選ぶ画面の「マイ素材」 | 素材づくり |
| AIで作り直す… | 作品全体 › マイ素材 › 素材のページ | 素材づくり（その素材を元に作り直す） |
| AIに説明してもらう… | 作品全体 › 写真・動画 › 写真・動画のページ | 写真の説明（送る前に毎回たずねます） |

表のボタンは道具を開くだけで、押しただけで送ることはありません。送るのは、道具そのもののボタン（「歌詞の下ごしらえ」「送る」「作る」
「送って説明してもらう」など）を押したときだけです。
AI タブやボタンが見えないときは、≡ › 設定 › 「AIを使う」をオンにしてください。

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

## 4. 指示（AIに頼む）

AI タブの **指示** の欄に、してほしいことを書いて **送る** を押します（300文字まで。Enter で送る、Shift+Enter で改行）。

- **対象**: **全体** / **選択中** / **区画▾** から選びます。
  - **全体**: 作品全体に頼みます。
  - **選択中**: 選んでいる行やカットだけに頼みます（行を選ぶと使えます）。
  - **区画▾**: 一覧から、頼む場所を選びます。一覧は「曲の区画（AI分析）」（サビ1 など）、「歌詞の見出し（#）」（`# サビ` のような行で分けたまとまり）、「まとまり（空行ごと）」、「選択中」に分かれています。曲の区画は「曲を分析する」をすると増えます（「曲を分析すると区画が増えます」）。
  - 選んだ場所は「◆ サビ1 · 0:41–1:02 · 5行」のように表示されます。マウスを乗せると、その行が光ります。× で全体に戻ります。
- よく使う言葉のボタン: **季節感** / **ゆっくり** / **緩急** / **カメラで寄る** / **素材を作る**。押すと、その言葉が欄に入ります。
- 例: 「ここは季節感を足して、動きはゆっくり」「サビをもっと派手に」「最初と最後は一瞬ゆっくり、途中はすごく速く」「文字にカメラで寄って」「桜の装飾は使わないで」
- **▸ 詳しく** を開くと、次の2つを選べます。
  - **新しい素材を作ってもよい**: オンにすると、AI が新しい素材（マイ素材）を作って使うことがあります（6 を見てください）。「素材を作る」のボタンを押すとオンになります。
  - **写真・動画をAIが使ってよい**: 写真・動画がこの端末にあるときだけ出ます。はじめはオンです。オンのとき、AI があなたの写真・動画を背景などに使うことがあります（7 を見てください）。オフのときは、写真・動画の番号・種類・大きさ・長さ・形・説明を送りません（背景などが写真・動画かどうかは、部品の名前として伝わります）。
- **カメラワークをAIに任せる**: カメラの動き（寄る・引く・区画のカメラ・緩急など）だけを AI に決めてもらいます。指示の文は空でもかまいません。
- 意味があいまいなときは、何も変えずに聞き返します（「AIからの質問: …」。区画ごとに頼んだときは「サビ1: …」のように区画の名前が付きます）。
  伝わらなかったときは「指示がうまく伝わりませんでした。言い方を変えて試してください。」と出ます。
- 詳細の **この行をAIに頼む…** / **この区画をAIに頼む…** / **このカットをAIに頼む…** を押すと、その場所を対象にした状態で指示の欄が開きます。

変更はその対象の中だけに入ります。対象の外も変わる提案は「区画の外（作品全体）」にまとまり、はじめはチェックが外れています（「区画の外も変わります」）。

## 5. 区画ごとに指示

指示の欄の下の **区画ごとに頼む…** を押すと、区画ごとに別々の指示を書ける画面が開きます（**‹ 戻る** で戻ります）。

- 曲の区画（なければ見出し、それもなければ空行ごとのまとまり）が1行ずつ並びます。それぞれに1行の指示を書きます（120文字まで）。
- 選んでいる行を区画として足すには **+ 選択中の行を区画にする** を押します。
- 書きかけの指示は作品に残ります。各行の右に「未送信」または「反映済み」と出ます。
- **まとめて送る** で、書いた区画をまとめて1回で頼みます。一度に送れるのは8区画までです（「一度に送れるのは8区画までです」）。
- この画面にも **新しい素材を作ってもよい** があります。
- 写真・動画については、指示の「詳しく」にある **写真・動画をAIが使ってよい** と同じ設定に従います。オフなら、区画ごとに頼むときも写真・動画の番号・種類・大きさ・長さ・形・説明を送りません。

## 6. 素材づくり（マイ素材）

AI に、新しい素材（文字の入り方・装飾・背景・空気など）を作ってもらえます。素材は、アプリにある部品と、決まった形（図形・粒・模様・動き・揺れ）の組み合わせで作る「データ」です。AI がプログラムを書いて動かすことはありません。

作ってもらう方法は3つあります。

1. **指示で**: 「詳しく」の **新しい素材を作ってもよい** をオンにして頼みます（「合う素材を作って使って」など）。結果の一覧の「素材」に新しい素材が出て、**見る** で動きを確かめられます。素材のチェックを外すと、それを使う変更も外れます。
2. **部品を選ぶ画面で**: 「マイ素材」を開き、**＋ AIで作る** を押します。どんな素材かを書き（例: 「文字が花びらのように舞って着地する」）、**作る** を押します。「作ったら選択中の…に使う」をオンにすると、できた素材をその場所に使います。
3. **作り直す**: 作品全体 › マイ素材 で素材を開き、**AIで作り直す…** に直したいことを書いて **作る** を押します。

- どの方法でも、結果はまずチェック付きの一覧に出ます（9 を見てください）。
- 作った素材は作品の中に保存され、部品を選ぶ画面の「マイ素材」に出ます。AI が作った素材は、使った場所にだけ出ます（素材のページで「おまかせでも使う」をオンにしたときを除く）。
- 使っているモデルで素材が作れないときは「素材づくりはこのモデルでは使えませんでした」と出て、素材なしの提案になります。

## 7. 写真・動画と AI

### 7.1 写真・動画を使ってもらう（指示）

「詳しく」の **写真・動画をAIが使ってよい** がオンのとき（はじめはオンです）、AI はあなたの写真・動画を、背景・写真の枠・文字の中・重ねる映像として使うことがあります（この端末にあるものだけ）。

- 写真・動画の **動きと重なり**（どう動くか・文字の前か後ろか）も、指示で変えられます。例: 「背景を後ろに下げて」「写真を前に出して」「背景は動かさないで」「背景も一緒に動かして」
- このとき AI に送るのは、写真・動画ごとの **番号**（asset:0 など）・**種類**（写真・動画・アニメ）・**大きさ**（幅×高さ）・**長さ**・**形**（横長・縦長・正方形）と、「AIに説明してもらう」で反映した説明（説明文や色など）だけです。
- **ファイル名は送りません。** 写真や動画の画像そのものも、ここでは送りません。
- オフにすると、写真・動画の番号・種類・大きさ・長さ・形・説明を送りません（背景などが写真・動画かどうかは、部品の名前として伝わります）。区画ごとに指示でも同じです。

### 7.2 AIに説明してもらう（写真の説明）

AI に写真・動画を見てもらい、何が写っているか・色・文字を置きやすい場所・**動きと重なり** のおすすめを出してもらいます。Google Gemini のときだけ使えます。

1. 詳細の 作品全体 › 写真・動画 から写真・動画を開き、「AI」の **AIに説明してもらう…** を押します。
2. **押すたびに、送る前に確認が出ます。** 送る内容が書いてあります。
   - 写真を小さくした JPEG（長い辺 768px。1枚あたりのおよその大きさも書いてあります）。動画とアニメは、始め・中ほど・終わりの3コマを送ります。
   - 送り先は Google Gemini です。
3. **送って説明してもらう** を押したときだけ送ります。やめれば何も送りません。
4. 結果はチェック付きの一覧に「写真「…」の説明: …」と出ます。反映すると、写真・動画のページに「…（AIの説明）」と「AIのおすすめ: 後ろに下げる」のようなおすすめと理由が出ます。

- 送らないもの: ファイル名、歌詞、写真に付いている撮影日時や場所などの情報（EXIF）。
- 写真・動画がこの端末にないとき（「この端末にありません」）は、つなぎ直してから使ってください。
- **動きと重なり** が「おまかせ」のときは、AI のおすすめを使います。おすすめがなければ、アプリが決まった考え方で選びます。いつでも手で選べます（詳細の背景・写真の枠・重ねる映像のページ）。
  - 選べるもの: おまかせ / 演出と一緒に動かす / 文字の前に出す / 後ろに下げる / 動かさない
- 色は、AI を使わずに「この色に合わせる」でも写真に合わせられます。

## 8. 曲を使う（Google Gemini のみ）

② 曲 で曲を読み込み、サービスが Google Gemini のときに使えます。まず同意のカードが出ます。

> 曲の音声を 16kHz モノラルにして Google Gemini に送ります（約 7MB・3:42）。この作品ではこのときだけ。

**この内容で送ることに同意する** にチェックを入れると、3つのボタンが使えます。

| ボタン | すること | 結果 |
|---|---|---|
| 書き起こす | 歌っている歌詞を聞き取ります | 「置き換える」か「後ろに足す」を選びます。「時刻をつける」で行頭に `[分:秒]` が入ります |
| タイミングを合わせる | 入力済みの歌詞の各行が、曲のどこで始まるかを探します | 行の開始時刻の変更として一覧に出ます（LRC の時刻より優先されます） |
| 曲を分析する | 雰囲気・テンポ・曲の構成（イントロ・サビなど）・聴きどころを調べます | 「保存する」で作品に保存し、あとの提案と「区画▾」に使います |

- 同意は、いま開いている作品についてだけ有効です。別の作品を開いたり、ページを読み込み直したりすると、もう一度たずねます。
- 音声はモノラルの WAV にして送ります。ふつうは 16 kHz（約7分まで）、長い曲は 12 kHz や 8 kHz（約14分まで）に下げて1回で送ります。それより長い曲は 16 kHz のままアップロードしてから使います。送る大きさと長さは、同意のカードに出ます。曲のファイル名は送りません。
- 送ってよい曲（自分の曲や、権利者の許可がある曲）だけに使ってください。公開されている歌詞と判断されると書き起こせません。そのときは歌詞を貼って「タイミングを合わせる」を使ってください。
- 時刻は目安です。ずれていたら、詳細やタップ合わせで直してください。
- サービスBでは、曲の音声は送れません（「Google Gemini のときだけ使えます」）。

## 9. 結果の確かめ方と取り消し

どの道具も、まず **チェック付きの一覧** で結果を見せます。この時点では「まだ何も変わっていません。反映するものを選んでください。」と出ていて、作品はまだ変わっていません。

- 一覧は、道具によって「歌詞 / 全体 / 行ごと / 時間」や「素材 / 区画 … / カット / 区画の外（作品全体）」に分かれています。
- 各行に「変更前 → 変更後」と理由が出ます。**すべて** / **なし** でまとめてチェックできます。いくつもの行に同じ変更をする項目は「5行 ▸」で中身を開けます。
- 頼んだあとで変わった項目には「この後に変更あり」が付き、チェックが外れます。入れ直せば反映できます。
- 使えなかった提案は「使えなかった提案 n件」にまとまります。
- **選んだ n 件を反映** で反映、**捨てる** で何も変えずに閉じます。一覧が開いているあいだ、「詳細」タブは使えません。
- 反映は「元に戻す」1回で取り消せます。
- **反映した AI の変更** に記録が残り、あとからでも **元に戻す** で、その回の変更のうち後で手を入れていないものだけを戻せます。
- AI が決めた値は「AIで固定」と表示されます。「AIが決めた固定 n」の **すべて自動に戻す** でまとめて自動に戻せます。

## 10. 送るものと送らないもの、保存されるもの

**写真・動画について**

- 送るのは、番号・種類・大きさ・長さ・縦長か横長かだけです。**ファイル名は送りません。**
- 「写真・動画をAIが使ってよい」がオンのときは、「AIに説明してもらう」で付いた説明・色・位置も送ります。
  このチェックは「指示」と「区画ごとに指示」で共通です。オフにすると、どちらも写真・動画を使いません。
- 写真・動画そのものは、写真・動画のページの「AIに説明してもらう…」からだけ、Google Gemini に送ります（サービスBには送りません）。
  小さな静止画にして送ります（長い辺 768px の JPEG。1枚の大きさの目安は確認のカードに出ます。動画・アニメは3枚で、使う範囲の始め・中ごろ・終わりです）。
- 送るたびに確認のカードが出ます。同意は記憶しません（写真ごとにも、作品ごとにも）。

**送り先**: 選んだ AI サービスだけです。ブラウザから直接送り、ほかのサーバーは通りません。

**送るもの**

- 歌詞のテキスト、あなたが書いた指示。
- 設定の数値と名前（テーマ・雰囲気・部品やマイ素材の名前・強さなど）と、保存した曲の分析。
- 「写真・動画をAIが使ってよい」がオンのとき（指示・区画ごとに指示。指示の「詳しく」の中にあり、はじめはオンです）: 写真・動画ごとの番号（asset:0 など）・種類・大きさ・長さ・形と、「AIに説明してもらう」で反映した説明（説明文や色など）。オフのときは、写真・動画の番号・種類・大きさ・長さ・形・説明を送りません（背景などが写真・動画かどうかは、部品の名前として伝わります）。
- 曲の音声: 「曲を使う」で同意したときだけ、Google Gemini に送ります。
- 写真・動画の画像: 「AIに説明してもらう」で、毎回出る確認で **送って説明してもらう** を押したときだけ、小さくした JPEG を Google Gemini に送ります。

**送らないもの**

- 写真・動画・曲の **ファイル名**（どの道具でも送りません）。
- APIキーは、選んだサービスとの接続にだけ使い、ほかには送りません。作品ファイル・記録・URL・エラーの文にも入りません。
- 同意していない曲の音声や、確認していない画像は送りません。サービスBには、曲の音声も画像も送りません。

**保存されるもの**

| もの | 場所 |
|---|---|
| APIキー | このブラウザだけ（ふだんはタブの中、「この端末に記憶する」ならブラウザに）。作品ファイルには入りません |
| サービス・モデル・記憶するかどうか | このブラウザ |
| 反映した変更・AI の記録・保存した曲の分析・反映した写真の説明・AI が作った素材 | 作品の中（ふつうの設定と同じ） |
| 区画ごとに指示の書きかけ | 作品の中 |
| AI に送った音声（WAV）・画像（JPEG）・同意 | 保存しません（読み込んだ曲や写真・動画そのものは、ふつうどおりこのブラウザに保存されます） |

≡ › 設定 › 「この端末に保存した作品・曲・写真・動画を消す」は、保存した AI のキーも消します。

## 11. 料金の表示

料金は、キーの持ち主に AI サービスから請求されます。一覧の下に、その回の量と金額の目安が出ます。

> 入力 3,210 / 出力 850 トークン · 約 $0.0056

- 金額は米ドルで表示します。
- gemini-3.8-flash の目安は、100万トークンあたり入力 $0.75 / 出力 $3.75 で計算しています（2026年12月31日までの価格です。その後は $1.50 / $7.50 になる予定なので、実際の請求は表示の約2倍になります）。
- 単価の分からないモデルでは、トークン数だけを表示します。
- キーの確認は無料です。

## 12. うまくいかないとき

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
| 写真の説明は Google Gemini のときだけ使えます | サービスを Google Gemini にします |
| 写真・動画がこの端末にないため、説明を頼めません。つなぎ直してから使ってください | 写真・動画のページの「つなぎ直す」でファイルを選びます |
| 素材づくりはこのモデルでは使えませんでした | 素材なしの提案が出ます。素材がほしいときは別のモデルを選びます |
| 一度に送れるのは8区画までです | 指示を書く区画を8つまでにします |

ボタンが押せないときは、理由がボタンの近くに出ます（「キーを入れると使えます」「歌詞を入れると使えます」
「曲を読み込むと使えます」「上の内容に同意すると使えます」「いまの提案を反映するか捨てると使えます」「区画を選んでください」など）。

## 13. AI がしないこと

- 確かめずに変えること。どの結果も一覧を見せ、選んだものだけを反映します。
- 歌詞の言葉を書き換えること（書き起こしを「置き換える」「後ろに足す」で選んだときを除く）。
- ロックした行の見た目や、手で固定した値を変えること。
- 使わないことにした部品や、季節に合わない部品を使うこと。
- プログラムを動かすこと。AI が作る素材は、決まった部品と形を組み合わせたデータだけです。
- ファイル名を送ること。写真・動画・曲のファイル名は、どの道具でも送りません。
- 同意なしに曲を送ること、確認なしに画像を送ること。サービスBに曲や画像を送ること。
- 「写真・動画をAIが使ってよい」がオフのときに、写真・動画を使うこと。
- キーを作品ファイルに書くこと、選んだサービス以外に送ること。
- 自分から動き出すこと。ボタンを押したときだけ送ります。

---

## AI assist guide (English)

AI assist is optional: every other feature works without it. It lives in the **AI** tab of the detail column. These
buttons open a tool there: **AI tidy-up** (step 1), **AI timing** (step 2, with a song), **Ask AI: 3 looks** (step 3),
**Ask AI about this line…** / **Ask AI about this section…** / **Ask AI about this cut…** (the pages in Details),
**+ Make with AI** (the **Mine** tab of the part browser), **Remake with AI…** (a material's page) and
**Ask AI to describe…** (a photo or video's page). These buttons only open the tool; nothing is sent until you press
the tool's own button (**Prepare lyrics**, **Send**, **Make**, **Send and describe** …). If the tab is missing, turn on
≡ › Settings › **Use AI**.

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
- **Instruction** — write what you want (up to 300 characters; Enter sends) and press **Send**. **Target**: **Whole** /
  **Selected** / **Section ▾** (song sections from the analysis, lyric headings (#), blocks by blank lines, or the
  selection). Phrase buttons: Seasonal / Slower / Speed ramp / Push in / Make a material. Under **Options**:
  **May create new materials** and **AI may use photos and videos** (shown when you have photos or videos on this
  device; on by default). **Let AI do the camerawork** changes camera fields only. If the request is unclear, the AI
  asks back ("The AI asks: …") instead of guessing. Changes stay inside the target; anything outside it is grouped
  under "Outside the section (whole video)" and starts unchecked.
- **Instructions per section** — **Ask per section…** opens one line per section (up to 120 characters each; drafts
  are kept in the project). **+ Use the selected lines as a section** adds one. **Send all** sends up to 8 sections at
  once ("Up to 8 sections per request"). It follows the same **AI may use photos and videos** setting as Instruction.
- **Make a material** — the AI builds a new material (an entrance, a decoration, a background, an atmosphere …) from
  the app's parts and a fixed set of shapes, particles, patterns and motions. It is data: the AI never runs code. Ask
  for one in Instruction (with **May create new materials** on), with **+ Make with AI** on the **Mine** tab of the
  part browser (describe it, then **Make**; "Use it on the selected … when done" places it), or with
  **Remake with AI…** on a material's page. AI-made materials show up only where they are used, unless you turn on
  **Use in automatic picks**.
- **Photos and videos in Instruction** — with **AI may use photos and videos** on (it is on by default, under
  **Options**), the AI may use your photos and videos as a background, a photo frame, inside the text or as overlay
  footage, and may change their **Motion and layering** ("push the background back", "keep the background still" …).
  It gets each one only as a number (asset:0 …) with its kind, size, length and shape, plus the description
  **Describe photos** stored for it. **File names are never sent**, and neither are the pictures. With the box off,
  no number, kind, size, length, shape or description of your photos and videos is sent (only the part names tell
  that a background or a frame shows a photo or video).
- **Describe photos** (Google Gemini only) — on a photo or video's page, **Ask AI to describe…**. **Every time**, a
  confirmation first says what will be sent: the picture made smaller (JPEG, 768 px on the long side, with its
  approximate size; a video or animation sends 3 frames: start, middle, end), to Google Gemini. Only **Send and
  describe** sends it; cancel and nothing is sent. The file name, the lyrics and the photo's EXIF data (such as when and
  where it was taken) are not sent. Applied, the page shows the description and "AI suggests: Push back" with a reason;
  **Motion and layering** on Auto uses that suggestion (Auto / Move with the animation / In front of the text /
  Push back / Keep still).
- **Use the song** (Google Gemini only) — after the consent card ("The song's audio will be sent to Google Gemini as
  16 kHz mono (about 7 MB, 3:42), this time only.") and **I agree to send it as described**: **Transcribe** (then
  **Replace** or **Add after**, optionally **Include the times**), **Match timing** (new line start times, which override
  LRC times) and **Analyze the song** (mood, tempo, sections, highlights; **Save** keeps it for later suggestions and
  for **Section ▾**). Consent covers the open project only and is asked again after opening another project or
  reloading. Audio goes as mono WAV: 16 kHz up to about 7 min, 12 or 8 kHz up to about 14 min, longer songs at 16 kHz
  through an upload; the consent card shows the size and length. The song's file name is not sent. Only send songs you
  may send; published lyrics cannot be transcribed — paste them and use Match timing.

### Review, apply, revert

Every result first appears as a checked list (Lyrics / Whole video / Per line / Timing, or Materials / Section … /
Cuts / Outside the section) with before → after and a reason; rows that change many lines open with "5 lines ▸". Rows
that changed after the request are unchecked and marked **Changed since**. **Apply the n selected changes** or
**Discard**; one undo takes an apply back. **AI changes applied** keeps a log: **Revert** undoes the changes of one run
that were not edited later. Values chosen by the AI show **Set by AI**; **Set all back to auto** clears them.

### What is sent, what is not, what is stored

Sent, directly from the browser to the service you chose and nowhere else: the lyric text, your instruction, setting
values and names (theme, mood, part and material names, amounts) and a saved song analysis. With **AI may use photos
and videos** on (Instruction and Instructions per section): each photo or video as a number with its kind, size, length
and shape, and the description Describe photos stored for it; with it off (it is on by default), none of that, and
only the part names tell that a background shows a photo or video. The song's audio only through **Use the song**,
after consent, to Google Gemini. Pictures only through **Describe photos**, after the confirmation that is shown every
time, as small JPEGs to Google Gemini.

Never sent: the **file names** of photos, videos or the song (by any tool); the key to anyone but the chosen service
(it is never written into project files, logs, URLs or error messages); audio without consent or pictures without the
confirmation; audio or pictures to the second AI service.

Photos and videos: only their number, kind, size, length and shape are sent (never file names). While **AI may use
photos and videos** is on, the description, colors and positions from **Ask AI to describe** are sent too; the switch is
shared by **Instruction** and **Instructions per section**, and while it is off neither uses your photos and videos. The
pictures themselves go only through **Ask AI to describe…** on a photo's page, only to Google Gemini (never to the second
service), as small stills: JPEG, 768 px on the long side (the consent card shows about how many KB per image); a video or
animation sends 3 frames, from the start, middle and end of the part used. You are asked every time: the consent is not
remembered, for a photo or for a project.

Stored: the key in this tab or browser (never in project files); the service/model choice in this browser; applied
changes, the AI log, a saved song analysis, photo descriptions, AI-made materials and drafts of Instructions per section
in the project. The WAV and JPEGs sent to the AI and the consent are not stored (the loaded song, photos and videos are
kept in this browser as usual). ≡ › Settings › **Clear projects, songs, photos and videos stored on this device** also
removes stored AI keys.

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
| Photo descriptions work only with Google Gemini | Switch the service to Google Gemini |
| The photos or videos are not on this device, so they cannot be described. Relink them first | Use **Relink** on the photo or video's page |
| This model could not make materials | The suggestions come without materials; pick another model if you want them |
| Up to 8 sections per request | Write instructions for at most 8 sections |

A disabled button says why next to it ("Enter a key to use this", "Add lyrics to use this", "Load a song to use this",
"Agree to the note above to use this", "Apply or discard the current suggestions first", "Pick a section" …).

### What the AI never does

It never changes anything without the review list; never rewrites the lyric words (except a transcript you choose to
use); never touches locked lines or values you pinned by hand; never uses parts you turned off or parts of another
season; never runs code (materials are data only); never sends file names; never sends audio without consent or
pictures without the confirmation, and never sends either to the second AI service; never uses your photos and videos
while **AI may use photos and videos** is off; never writes the key into a project file or sends it anywhere but the
chosen service; and never runs on its own.
