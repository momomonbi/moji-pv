# AAC 320 kbps conversion server

moji-pv の書き出し動画へ、元の曲から作った音声を AAC **320 kbps を目標**として組み込みます。ブラウザの AAC エンコーダーが 192 kbps までしか対応しない場合にも使えます。H.264 映像は `-c:v copy` でそのまま保持するため、映像の画質は変わりません。

AAC は FFmpeg のネイティブエンコーダーを使います。320 kbps は指定する目標値で、固定ビットレートの保証ではありません。無音や単純な音では実測値が小さくなることがあります。返却ヘッダーで目標値と実測値を区別します。ブラウザから送る WAV は元音源から作るため、192 kbps に圧縮した音を再圧縮する構成ではありません。元音源が低音質なら、ビットレートを上げても失われた音は復元できません。

このフォルダーは公開用のサーバー一式です。作成しただけでは公開されません。HTTPS のサーバーへ配置し、アプリの書き出し設定にその URL とアクセストークンを入力すると使えます。曲・動画は設定したサーバーへアップロードされます。変換に成功した後も、エラー・キャンセル時も一時ファイルを削除します。サーバーは音源や動画を保存する機能を持ちません。

## ローカル検証

Python 3.12 以降、FFmpeg / ffprobe が必要です。FFmpeg の AAC エンコーダーと MP4 muxer を含む通常の配布を使ってください。

```sh
cd server/audio
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements-test.txt
export AUDIO_SERVER_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export AUDIO_ALLOWED_ORIGINS=https://momomonbi.github.io
uvicorn service:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

別のターミナルから `curl http://127.0.0.1:8000/health` で接続確認できます。ローカルの HTTP はサーバー検証用です。公開アプリの接続先には HTTPS の URL を指定します。

```sh
# リポジトリのルートから実行。実際に FFmpeg で AAC 化して検証します。
python3 -m unittest discover -s server/audio/tests -v
```

## VPS / Docker

このフォルダーで `.env.example` を `.env` にコピーし、`AUDIO_SERVER_TOKEN` を長いランダムな値に置き換えます。`.env` は Git に登録しないでください。

```sh
docker compose up --build -d
```

Compose は `127.0.0.1:8000` のみに接続を公開します。Caddy・nginx などで HTTPS のリバースプロキシを設定し、公開 URL をアプリに入力してください。アクセストークンを URL に含めないでください。

Compose のサンプルは CPU 2 個、メモリ 2 GB、`/tmp` の上限 1 GB、同時処理 1 件、アップロード全体 256 MiB としてあります。アップロード一時ファイル・コピー・出力を合わせて、処理中には送信容量の約 2 倍までの一時領域が必要です。上限や同時処理数を増やす際は、`compose.yaml` のディスク・メモリ制限も合わせて調整してください。AAC の変換は CPU で行います。

リバースプロキシの本文サイズとタイムアウトも、サービスの上限以上にしてください。nginx の例では `client_max_body_size 256m; proxy_read_timeout 1800s; proxy_send_timeout 1800s; proxy_request_buffering off;` を変換用の location に設定します。ホスティングサービス自体のリクエスト時間・本文サイズの上限が小さい場合は、曲を短くするか、大きなリクエストを扱える VPS を選んでください。

サービスは **Uvicorn 1 worker** を前提に、アップロード開始からダウンロード完了まで同時処理数を制限します。worker 数を増やすと、それぞれに上限が適用されます。大きなリクエストを無制限に待ち行列へ入れず、枠が空かない場合は 429 を返します。

## Render の例

`render.yaml` は Render Blueprint の例です。リポジトリのルートを基準とした Dockerfile と build context を指定しています。Render の Blueprint 作成時にこのファイルを選ぶか、Web Service を作成して次を設定します。

- Runtime: Docker
- Dockerfile: `server/audio/Dockerfile`
- Docker build context: `server/audio`
- Health check: `/health`
- `AUDIO_SERVER_TOKEN`: 長いランダムな値
- `AUDIO_ALLOWED_ORIGINS`: `https://momomonbi.github.io`
- `AUDIO_MAX_UPLOAD_BYTES`: `268435456`
- `AUDIO_MAX_CONCURRENT`: `1`

例は有料の standard プランを指定しています。公開・料金の発生はデプロイを実行したときです。この実装ではデプロイしていません。契約するプランと Render 側の本文・リクエスト時間の上限を確認し、必要なら VPS を使ってください。生成したトークンは Render の環境変数から確認し、HTTPS のサービス URL と一緒にアプリへ設定します。

## 環境変数

| 変数 | サービス既定値 | 意味 |
| --- | --- | --- |
| `AUDIO_SERVER_TOKEN` | なし・必須 | POST に必要な Bearer トークン。空だと起動しません |
| `AUDIO_ALLOWED_ORIGINS` | `https://momomonbi.github.io` | 許可する Origin のカンマ区切り。`*` は不可 |
| `AUDIO_MAX_UPLOAD_BYTES` | `1073741824` | multipart 本文全体の最大バイト数 |
| `AUDIO_MAX_CONCURRENT` | `2` | アップロード・変換・ダウンロードの同時処理上限 |
| `AUDIO_QUEUE_TIMEOUT_SECONDS` | `1` | 処理枠を待つ上限秒数 |
| `AUDIO_CONVERSION_TIMEOUT_SECONDS` | `1800` | アップロード開始から検証・変換までの上限秒数 |
| `AUDIO_MAX_DURATION_SECONDS` | `3600` | 最大動画秒数 |
| `AUDIO_MAX_VIDEO_PIXELS` | `33554432` | 動画幅×高さの最大値 |
| `AUDIO_FFMPEG_THREADS` | `2` | 各 FFmpeg プロセスのスレッド数 |
| `AUDIO_TEMP_DIR` | OS の一時領域 | 書き出す一時ファイルの保存先 |
| `AUDIO_FFMPEG` / `AUDIO_FFPROBE` | `ffmpeg` / `ffprobe` | サーバー管理者が指定する実行ファイル |
| `PORT` | Docker: `8000` | Uvicorn の待受ポート |

許可 Origin はホストの Origin です。アプリのパスを含めません。日本語版・英語版とも `https://momomonbi.github.io` です。ローカル UI 検証には、その開発サーバーの Origin を追加してください。Origin に関係なく POST のトークン認証は必須です。

## API v1

### `GET /health`

接続確認用です。認証は必要ありません。

```json
{"service":"moji-pv-audio","version":1,"targetBitrate":320000,"maxUploadBytes":1073741824}
```

`maxUploadBytes` は 2 ファイルの合計だけでなく、multipart のフィールドと境界を含みます。クライアントはファイル合計に 64 KiB 程度の余裕を加えて送信可否を判断できます。実際の上限は受信しながら検証します。Content-Length がない場合や虚偽の場合も制限されます。

### `POST /v1/convert`

`Authorization: Bearer <AUDIO_SERVER_TOKEN>` を付け、multipart/form-data で次の **4 項目のみ**を送信します。

| フィールド | 内容 |
| --- | --- |
| `video` | 音声なしの H.264 MP4。先頭時刻 0、1 sample = 1 frame |
| `audio` | ステレオ・48 kHz・16 bit PCM WAV。曲から切り出し済み |
| `frames` | 動画のフレーム数。正の整数 |
| `fps` | `24` / `25` / `30` / `50` / `60` |

動画のフレーム数・fps・長さが一致することを、MP4 sample / packet 数で検証します。音声の長さは `frames / fps` の ±0.1 秒以内であることを確認し、端数分は無音追加・末尾カットで正確に合わせます。入力ファイル名は使わず、サーバー側の固定名を使います。URL やサーバー内のパスを指定する API はありません。MP4/WAV demuxer を明示し、MP4 の外部トラック参照と絶対パス参照を無効にしています。

動画はコピーし、WAV だけを AAC へ変換します。音声の追加オフセットは設けません。`-movie_timescale 48000 -use_editlist 1` で AAC の priming を編集リストへ正しく反映します。完了後は音声・動画の開始時刻と長さ、フレーム数を再確認します。

成功時は `200 video/mp4` で動画をストリーミングします。次のヘッダーを CORS で公開します。

- `X-Audio-Bitrate-Target: 320000`
- `X-Audio-Bitrate-Measured: <ffprobe の実測平均ビットレート>`（取得できた場合）
- `X-Audio-Codec: aac`
- `X-Video-Frames: <frames>`
- `Content-Length`
- `Content-Disposition`

エラーは `{ "code": "...", "message": "..." }` の JSON です。

| HTTP | code | 内容 |
| --- | --- | --- |
| 401 | `unauthorised` | トークンなし・不一致 |
| 403 | `origin_forbidden` | 許可外 Origin |
| 413 | `upload_too_large` | 本文上限を超過 |
| 422 | `invalid_request` | フィールド・multipart・frames/fps が不正 |
| 422 | `invalid_media` | MP4/WAV・codec・長さ・開始時刻が不正 |
| 429 | `server_busy` | 同時処理枠がいっぱい |
| 499 | `client_disconnected` | クライアント切断（接続が切れているため応答を受信できない場合があります） |
| 504 | `conversion_timeout` | 受信・検証・変換の時間制限 |
| 500 | `conversion_failed` | 保存・実行・出力検証に失敗 |

切断・キャンセル・時間切れでは、FFmpeg / ffprobe の子プロセスを kill・wait して一時ファイルを削除します。応答後もファイルは保存しません。プロセスやコンテナそのものの強制終了では Python の後処理を実行できないため、一時領域は専用の揮発性領域を使ってください。
