# secret-broker

> AIエージェント向けのローカル秘密ブローカー。macOS Keychain 裏付け、AES-256-GCM 保存時暗号化、参照渡し。サーバー不要、シェル履歴に平文を残さない。

AIエージェント（Claude Code・Cursor 等）にAPIトークンを渡したいけど、チャットに直書きしたくない・`.env` ファイルが `git status` に出てきてヒヤッとしたくない、そういう時のためのツール。エージェントが秘密を **「要求 (request)」** すると、macOS のネイティブダイアログ（パスワード入力欄）が表示され、入力値をディスクに暗号化保存し、エージェントには **「参照」だけ** を返します。生の値はチャット・シェル履歴・ログ・argv のどこにも出ません。

```
agent: secret request CLOUDFLARE_API_TOKEN --why "deploy worker"
            │
            ▼
  ┌───────────────────────┐         macOSネイティブダイアログ
  │  CLOUDFLARE_API_TOKEN  │  ◀──── (隠し入力、オーナーのGUI)
  │  用途: deploy worker   │
  │  [          ******** ] │
  │     [キャンセル] [OK]   │
  └───────────────────────┘
            │
            ▼
   AES-256-GCM(VMK from Keychain) → ~/.config/secret-broker/<ns>/CLOUDFLARE_API_TOKEN
            │
            ▼
agent: secret run CLOUDFLARE_API_TOKEN -- wrangler deploy
       └──── 値は子プロセスのenvにだけ存在、ディスク/stdoutには絶対出ない ────┘
```

---

## なぜ `.env` じゃダメなのか

| | `.env` | `secret-broker` |
|---|---|---|
| ディスク上の平文 | あり（単一障害点） | **なし — AES-256-GCM、鍵はKeychain** |
| `.gitignore` の規律 | プロジェクトごとに毎回必要 | **不要**（保管先はリポ外） |
| プロジェクト単位のスコープ | 手動管理 | **自動**（git root = namespace） |
| エージェントが値を見られるか | はい（ファイルを読む） | **いいえ** — エージェントは参照しか持たず、値はenv経由で透過注入のみ |
| シェル履歴流出に耐えるか | 弱い | 強い（GUIダイアログ入力、echoなし） |

---

## インストール

```bash
npm install -g secret-broker      # `secret` コマンドが PATH に入る
```

グローバルに入れずに使う場合:

```bash
npx secret-broker <command>
```

要件: macOS、Node 20以上、GUIセッション（ダイアログ表示用。SSHのみのセッションでは TTY フォールバックが必要 — [ロードマップ](#ロードマップ) 参照）。

---

## クイックスタート

```bash
# 1) オーナー: 秘密を対話的に登録
secret set CLOUDFLARE_API_TOKEN
# (ネイティブダイアログが出て、隠し入力で値を入れる)

# 2) 値を露出させずに使う
secret run CLOUDFLARE_API_TOKEN -- wrangler deploy

# 3) 確認 — 名前だけ表示、値は決して出ない
secret ls

# 4) 既存の .env を取り込んで元ファイルを削除
secret import-env .env
rm .env  # もう平文は不要
```

AIエージェント側の使い方は [`skills/secure-secrets.md`](skills/secure-secrets.md) を参照。

---

## コマンド一覧

| コマンド | 用途 |
|---|---|
| `secret request <NAME> --why "<text>"` | エージェントがダイアログでオーナーに値を要求 |
| `secret set <NAME>` | オーナーがダイアログで自分で登録 |
| `secret run <NAME[,N2,…]> -- <cmd>` | 秘密(複数可)をenvに注入して `<cmd>` を実行 |
| `secret get <NAME>` | mode 0600 の一時ファイルに書き出してパスを返す |
| `secret ls [--json]` | 現在のnamespaceの秘密名一覧 |
| `secret rm <NAME>` | 秘密を削除 |
| `secret import-env <path>` | `.env` 形式のファイルを一括取り込み |
| `secret help` / `--version` | ヘルプ / バージョン |

終了コード:
- `0` 成功
- `1` エラー（不在 / 復号失敗など）
- `2` ユーザーがダイアログをキャンセル

---

## 仕組み

**3つの核となるプリミティブ:**

1. **マスター鍵（VMK）** — 32バイトの AES-256 鍵を初回利用時に生成し、**macOS Keychain** のサービス `secret-broker-vmk` に保管。ブローカー CLI のみが触れる。エージェントが直接 Keychain にアクセスすることはなく、必ず CLI 越し。
2. **AES-256-GCM 保存時暗号化** — すべての秘密を `v2:` 形式で暗号化: `base64(VMKフィンガープリント(4) || iv(12) || ciphertext || tag(16))`。各 ciphertext は **`namespace:name` で AAD バインド** されているため、暗号化blobを別の秘密スロットに付け替えても復号失敗する。
3. **参照渡し（deliver-by-reference）** — エージェントは `secret run`（env注入、ディスク残骸なし）か `secret get`（mode 0600 一時ファイル、5分で自動掃除）を使う。値が stdout・argv・シェル履歴・チャットコンテキストに出ることは一切ない。

**Namespace = git root（無ければ cwd）。** 各プロジェクトの秘密は絶対パスをハッシュ化したディレクトリ配下に隔離される。`/my/project-a` 下に保存した秘密は、`/my/project-b` で動くエージェントからは存在自体が見えない。

**多層防御:**
- VMK フィンガープリントを ciphertext に埋め込み → 鍵がローテート/再生成された時に、汎用的な auth-tag mismatch ではなく明示的なエラーが出る。
- AAD = `<ns>:<name>:v2` → ciphertext を別の名前に付け替えると認証失敗。
- ファイルロックで同名の秘密に対する同時ダイアログ表示を防ぐ。
- ジャニター（janitor）が 5分以上経った `get` の一時ファイルを掃除（パターンマッチ防御: `<NAME>.<unixMs>.<pid>` 形式のファイルしか対象にしない）。

---

## セキュリティモデル — 何を守って何を守らないか

**守れるもの:**
- シェル履歴 / ターミナルスクロールバック / チャットへの平文貼り付け。
- リポ内に残った `.env` が誤コミットされる事故。
- エージェントへのプロンプトインジェクションで「秘密を echo / ログ出力させる」攻撃 — エージェントは参照しか受け取らない。
- 暗号化ファイル**だけ**の流出（復号には Keychain の VMK も必要）。
- Keychain の VMK **だけ**の流出（復号には暗号化ファイルも必要）。

**守れないもの:**
- ローカルユーザーアカウントの完全な乗っ取り。攻撃者があなたとして実行できるなら、CLI を起動して値を取得できる。これは `.env` でもどんなローカル秘密管理でも同じ脅威モデル。
- 悪意あるローカルプロセスによるダイアログ偽装（認証コード未実装 — [ロードマップ](#ロードマップ) 参照）。
- 復号中のプロセスのメモリ読み取り。（`secret run` の前後数ミリ秒、値は親プロセスメモリ上に存在してから子プロセスのenvに渡される）
- 秘密を「使った後」のネットワーク傍受。ブローカーはツールに渡すまで責任を持つ。その先はツールの責任。

**意図的にスコープ外** （[`docs/DESIGN.md`](docs/DESIGN.md) 参照）:
- トークンの発行 / mint（ユーザー提供の値を保管するだけで、マスター資格情報から最小権限トークンを発行する機能は持たない）。
- マシン間 / デバイス間同期。macOSのみ、同一マシンのみ。
- TTL / lease / killswitch。
- 監査ログUI。

これらが必要なら、[Bitwarden Agent Access](https://github.com/bitwarden/agent-access) や [joelhooks/agent-secrets](https://github.com/joelhooks/agent-secrets) を見てください。違うトレードオフで同じ領域をカバーしています。

---

## 保管ファイル配置

```
~/.config/secret-broker/
└── <namespace-hash>/           # git root or cwd を sha256 した先頭16文字
    ├── CLOUDFLARE_API_TOKEN     # AES-GCM ciphertext, mode 0600
    ├── LINE_CHANNEL_TOKEN
    ├── .tmp/                    # `secret get` の一時ファイル、5分で自動掃除
    └── .locks/                  # 要求ロック（pid死亡時は自動回収）
```

Keychain エントリ: サービス `secret-broker-vmk`、アカウント `<unix username>`、値 = base64(ランダム32バイト)。

---

## Claude Code から使う

[`skills/secure-secrets.md`](skills/secure-secrets.md) をプロジェクト（またはグローバル）に置けば、エージェントが正しい使い方を理解します:

- 秘密値を echo / cat / print しない。
- まず `secret run NAME -- cmd` を試す。
- env 注入が不可能な場合のみ `secret get NAME`（パスファイル）にフォールバック。
- ダイアログがキャンセルされたら、ループせず別アプローチをオーナーに相談する。

---

## ロードマップ

v1 で意図的に保留したが、将来検討する価値があるもの:

- **アンチフィッシング認証コード** — ダイアログとCLI双方に4桁コードを表示してマッチさせる。悪意あるローカルプロセスによる偽ダイアログを防ぐ。
- **TTL / killswitch** — エージェントが暴走した時に `secret revoke --all` で全復号可能秘密を即時無効化。
- **Linux / Windows 移植** — ダイアログ（`zenity` / PowerShell）と Keychain（`libsecret` / Credential Manager）を抽象化。
- **1Password / Bitwarden フォールバック** — `secret get` が OS Keychain → 1P/BW vault の順に探索、チーム共有値に対応。

---

## 開発

```bash
git clone https://github.com/xsjd2019/secret-broker.git
cd secret-broker
npm install
npm test                  # 80テスト
npm run build
npm run typecheck
```

コードベースは小さい（合計1000行未満）、本番依存ゼロ、各モジュールが個別のテストファイルを持つ構造です。`test/` を見てください。

---

## ライセンス

MIT — 自由に使い・fork し・配布してください。詳細は [`LICENSE`](LICENSE)。
