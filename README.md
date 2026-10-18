# VTuber ツール (Live2D × iPhone トラッキング / 音声 + ローカル LLM)

Live2D アバターを動かして、OBS 経由で YouTube にゲーム配信するためのローカルツールです。
動かし方を 3 つから選べます。

| モード | 内容 |
| --- | --- |
| 📱 iPhone トラッキング | iPhone のカメラで顔の向き・目・口・眉・視線を追従 |
| 🎙️ 音声 + ローカル LLM | マイク音量で口パク (母音っぽさで口の形も変化)、発言内容をローカル LLM が読んで表情・ジェスチャーを決定 |
| ✨ ハイブリッド | iPhone トラッキング + 発言内容に応じて表情を強調 |

iPhone は 2 通りで接続できます。

- **Safari (アプリ不要)** — QR を読むだけ。MediaPipe で顔認識
- **VTube Studio アプリ (高精度)** — iPhone の Face ID カメラ (ARKit) を使うので精度が高い

## 必要なもの

- Node.js 20 以上
- Chrome または Edge (コントロール画面。音声認識に使用)
- OBS Studio
- (音声モード) [Ollama](https://ollama.com/) と軽量モデル。例: `ollama pull qwen2.5:3b`
  - さらに速さ優先なら `qwen2.5:1.5b`、精度優先なら `qwen2.5:7b` / `gemma3:4b` など
  - Ollama が無くてもキーワード判定で動きます

## 起動

### 初回だけ

1. Windows に [Node.js](https://nodejs.org/) (20 以上) をインストール
2. このリポジトリを clone して依存パッケージを入れる

   ```sh
   git clone https://github.com/ikkungames110/vtuber.git
   cd vtuber
   npm install
   ```

3. (音声モードを使う場合) [Ollama](https://ollama.com/) をインストールしてモデルを入れる

   ```sh
   ollama pull qwen2.5:3b
   ```

### 毎回の起動

iPhone から PC に繋ぐため、**サーバーは必ず Windows 側の Node.js で動かします**。

| どこから起動する？ | 方法 |
| --- | --- |
| WSL のターミナル | `npm run start:win` |
| Windows のエクスプローラー | フォルダ内の `start.bat` をダブルクリック |
| Windows のターミナル (PowerShell など) | `npm start` |

> ⚠ WSL のターミナルで `npm start` を使うと WSL の中で動いてしまい、iPhone から繋がりません (QR に `172.x.x.x` が出ます)。

起動するとコンソールに URL が出ます。

- コントロール画面: http://localhost:3000/control.html (ブラウザで開く)
- OBS 用: http://localhost:3000/avatar.html
- iPhone 用: `https://<PC の LAN IP>:3443/phone.html` (コントロール画面に QR が出ます)

初回起動時に Windows ファイアウォールの確認が出たら「プライベートネットワーク」を許可してください。
止めるときはコンソールで `Ctrl + C`。

## OBS の設定

1. ソース追加 →「ブラウザ」
2. URL: `http://localhost:3000/avatar.html`、幅 1920 / 高さ 1080
3. 背景は透過されるので、ゲーム画面の上に重ねるだけ

ウィンドウキャプチャで使う場合は `avatar.html?bg=green` でグリーンバックになります。

## iPhone トラッキング

### Safari (アプリ不要)

1. iPhone と PC を同じ Wi-Fi に繋ぐ
2. コントロール画面の QR を iPhone で読み取る
3. 自己署名証明書の警告が出るので「詳細を表示」→「この Web サイトを閲覧」
4. 「トラッキング開始」→ カメラを許可
5. まっすぐ前を向いて「正面をリセット」

iPhone は顔の正面・少し下にスタンドで固定してください。充電しながらの使用推奨です。

### VTube Studio アプリ

1. iPhone に VTube Studio をインストールして起動
2. 設定 →「3rd Party PC Clients」を ON
3. 表示された iPhone の IP をコントロール画面の「VTube Studio アプリ」タブに入力

(PC 側は UDP 50510 番で受信します。ファイアウォールで許可してください)

## 音声 + LLM モード

1. コントロール画面で「音声 + ローカル LLM」を選択
2. 「マイク開始」→ マイクを許可
3. 話すと口パクし、認識した発言から表情・ジェスチャー (うなずき・首ふり等) が変わります
   - 話し終わる前でも、途中の認識結果で先に判定するので反応が速めです
   - LLM の判定時間はコントロール画面に ms で表示されます

コントロール画面のタブは **閉じずに開いたまま** にしてください (裏に回っても口パクは動きます)。
音声認識は Chrome / Edge 内蔵のもの (Web Speech API) を使います。

### 手動で表情を変える

コントロール画面のボタン、またはページにフォーカスがある状態で 1〜8 キー。

## 内蔵モデル「氷色ビッシューネン」(立ち絵 + 口パク)

表情シート (口閉じ / 半開き / 開き) から作った立ち絵モデルが最初から選ばれています。カメラは不要で、「🎙️ 音声 + ローカル LLM」モードでマイクを開始するだけで動きます。

- 喋る声の大きさに応じて口の差分を 3 段階で切り替え (口元だけ差し替えるので髪などはチラつきません)
- たまにほんの少し左右にゆらゆら揺れる (喋っている間は揺れやすい) + 呼吸
- 画像は `public/builtin/hyoshoku/`、動きは `public/builtin/pngtuber.js`
- モデルを選び直すと大きさ・位置がおすすめ値 (大きさ 1 / 上下 0) に戻ります

## 内蔵モデル「氷色天使」

設定画 (クリーム×白の天使系) を基にした内蔵モデルです (モデル一覧の「氷色天使 (内蔵モデル)」)。
ファイルの追加は不要で、Live2D と同じパラメータ ID で動くので、トラッキング・口パク・表情・ジェスチャーがそのまま使えます。

- 動くところ: 顔の向き (左右・上下・傾き)、体の傾き、まばたき・笑顔の目、視線、眉、口の開閉・形、頬染め、呼吸
- 物理演算で揺れるところ: 前髪・後ろ髪・アホ毛・髪飾りの星・天使の輪・コート・リボン・ぬいぐるみ
- 実体は `public/builtin/angel.js` (Canvas 2D でパーツごとに描画)。Cubism Editor で作る `.moc3` モデルではありません
- 画質: `avatar.html?res=2` のように描画解像度を上げられます (既定 1.5)

## 自分のモデルを使う

`models/` に `*.model3.json` を含むフォルダを置き、コントロール画面のモデル一覧から選択。
Live2D 標準のパラメータ ID (`ParamAngleX`, `ParamEyeLOpen`, `ParamMouthOpenY`, `ParamMouthForm` など) に対応したモデルならそのまま動きます。
モデルに表情ファイル (exp3) がある場合は「モデル付属の表情ファイルを使う」で感情と対応付けできます。

向きが逆に動く場合は「左右反転 / 上下反転 / 傾き反転」で調整してください。

## WSL2 で動かす場合

ブラウザ・OBS (localhost) からはそのまま使えますが、**iPhone から WSL2 内のサーバーには届きません** (QR に `172.x.x.x` が出て読み込みが終わらない状態になります)。

いちばん簡単なのは、WSL のターミナルから Windows 側の Node.js で起動する方法です (Windows に Node.js が必要)。

```sh
npm run start:win
```

または `%UserProfile%\.wslconfig` に以下を書いて `wsl --shutdown` で再起動する方法もあります。

```ini
[wsl2]
networkingMode=mirrored
```

Ollama を Windows 側で動かしている場合は、コントロール画面の「LLM 設定」で URL を調整してください
(mirrored モードなら `http://127.0.0.1:11434` のままで OK)。

## 構成

```
server.js            HTTP(3000)/HTTPS(3443) サーバー、WebSocket 中継、Ollama 呼び出し、VTS 受信
lib/emotion.js       発言 → 表情 (LLM + キーワードのフォールバック)
lib/vts.js           VTube Studio iPhone アプリからの UDP 受信
public/avatar.*      Live2D 描画 (OBS 用)
public/control.*     コントロール画面 (モード切替・マイク・音声認識・設定)
public/phone.*       iPhone 用トラッカー (MediaPipe Face Landmarker)
public/lib/face.js   ARKit ブレンドシェイプ → アバターパラメータ変換
```

サンプルモデル (Haru) は Live2D Inc. のサンプルデータです。利用時は [Live2D の無償提供マテリアル使用許諾](https://www.live2d.com/eula/live2d-free-material-license-agreement_jp.html) に従ってください。
Live2D Cubism Core は初回起動時に Live2D 公式からダウンロードされます。
