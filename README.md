# secret-broker

> Local secret broker for AI agents. macOS Keychain-backed, AES-256-GCM at-rest, deliver-by-reference. No server, no plaintext in shell history.

When an AI agent (Claude Code, Cursor, etc.) needs an API token, you don't want to type it into a chat or paste it into a `.env` that lingers in `git status`. `secret-broker` lets the agent **request** the secret, prompts you with a native macOS dialog (hidden input), encrypts the value to disk, and gives the agent back a **reference** — never the raw value in chat, shell history, logs, or argv.

```
agent: secret request CLOUDFLARE_API_TOKEN --why "deploy worker"
            │
            ▼
  ┌───────────────────────┐         macOS native dialog
  │  CLOUDFLARE_API_TOKEN  │  ◀──── (hidden input, owner's GUI)
  │  用途: deploy worker   │
  │  [          ******** ] │
  │      [Cancel] [OK]     │
  └───────────────────────┘
            │
            ▼
   AES-256-GCM(VMK from Keychain) → ~/.config/secret-broker/<ns>/CLOUDFLARE_API_TOKEN
            │
            ▼
agent: secret run CLOUDFLARE_API_TOKEN -- wrangler deploy
       └──── value lives only in the spawned child's env, never on disk/stdout ────┘
```

---

## Why not just `.env`?

| | `.env` | `secret-broker` |
|---|---|---|
| Plaintext on disk | yes (single point of failure) | **no — AES-256-GCM, key in Keychain** |
| `.gitignore` discipline | required every project | **not needed** (storage is outside the repo) |
| Per-project scope | manual | **automatic** (git root = namespace) |
| Agent sees value | yes (reads file) | **no** — agent gets a reference; value is env-injected only |
| Survives shell history dumps | no | yes (input via GUI dialog, no echo) |

---

## Install

```bash
npm install -g secret-broker      # exposes `secret` on PATH
```

Or run directly without installing globally:

```bash
npx secret-broker <command>
```

Requirements: macOS, Node ≥ 20, GUI session for the dialog (SSH-only sessions will need TTY fallback support — see [Roadmap](#roadmap)).

---

## Quick start

```bash
# 1) Owner: store a secret interactively
secret set CLOUDFLARE_API_TOKEN
# (native dialog appears, hidden input)

# 2) Use it without ever exposing the value
secret run CLOUDFLARE_API_TOKEN -- wrangler deploy

# 3) Inspect — names only, never values
secret ls

# 4) Migrate an existing .env into the broker, then delete the file
secret import-env .env
rm .env  # plaintext is no longer needed
```

For an AI agent's usage pattern, see [`skills/secure-secrets.md`](skills/secure-secrets.md).

---

## Commands

| Command | Purpose |
|---|---|
| `secret request <NAME> --why "<text>"` | Agent asks owner for a secret via dialog |
| `secret set <NAME>` | Owner stores a secret via dialog |
| `secret run <NAME[,N2,…]> -- <cmd>` | Exec `<cmd>` with secret(s) injected as env vars |
| `secret get <NAME>` | Write a mode-600 temp file, print the path |
| `secret ls [--json]` | List secret names in the current namespace |
| `secret rm <NAME>` | Delete a secret |
| `secret import-env <path>` | Bulk import a `.env`-style file |
| `secret help` / `--version` | Help / version |

Exit codes:
- `0` success
- `1` error (not found, decrypt failed, etc.)
- `2` user cancelled the dialog

---

## How it works

**Three primitives:**

1. **Vault Master Key (VMK)** — a 32-byte AES-256 key generated on first use and stored in the **macOS Keychain** under service `secret-broker-vmk`. Only the broker CLI ever touches it. Agents access secrets only via the CLI, never the Keychain directly.
2. **AES-256-GCM at-rest** — every secret is encrypted with `v2:` format: `base64(VMKFingerprint(4) || iv(12) || ciphertext || tag(16))`. Each ciphertext is **AAD-bound** to its `namespace:name` so a blob can't be silently relocated to another secret slot.
3. **Deliver-by-reference** — agents call `secret run` (env injection, no disk artifact) or `secret get` (mode-0600 temp file, auto-swept after 5 min). The value never reaches stdout, argv, the shell history, or the agent's chat context.

**Namespace = git root (or cwd).** Each project's secrets live in their own directory hashed from the absolute path, so secrets stored under `/my/project-a` are invisible to an agent running in `/my/project-b`.

**Defense in depth:**
- VMK fingerprint embedded in ciphertext → clear error when the key has rotated, instead of a generic auth-tag mismatch.
- AAD = `<ns>:<name>:v2` → re-binding a ciphertext to a different name fails authentication.
- File locks prevent concurrent dialogs for the same name from racing.
- Janitor sweeps stale `get` temp files older than 5 minutes (defensive pattern-matched: only files matching `<NAME>.<unixMs>.<pid>` are eligible for cleanup).

---

## Security model — what it does and does not protect

**It protects against:**
- Pasting plaintext into shell history / terminal scrollback / chat.
- Plaintext `.env` files lingering in the repo and getting committed accidentally.
- An agent prompt-injection that tries to exfiltrate the secret by `echo`ing or logging the value — agents only ever receive references.
- Reading the encrypted file alone (you also need the Keychain VMK).
- Reading the Keychain VMK alone (you also need the encrypted file).

**It does NOT protect against:**
- A fully compromised local user account. If the attacker runs as you, they can run the CLI and read the secret. Same threat model as `.env` or any local credential store.
- A malicious local process spoofing the dialog (no verification code yet — see [Roadmap](#roadmap)).
- Memory inspection of the running process during decrypt. (Pre-`run`, the value is in process memory for a few milliseconds before being passed to the child env.)
- Network-level interception of the secret's eventual use. The broker delivers to your tool; what your tool does with it is your tool's problem.

**Out of scope** (intentionally — see [`docs/DESIGN.md`](docs/DESIGN.md)):
- Token issuance / minting (we supply user-provided secrets, we do not generate them from a master credential).
- Cross-machine / cross-device sync. macOS only, same machine only.
- TTL / leases / killswitch.
- Audit log UI.

If you need any of those, look at [Bitwarden Agent Access](https://github.com/bitwarden/agent-access) or [joelhooks/agent-secrets](https://github.com/joelhooks/agent-secrets) — they cover the gaps with different trade-offs.

---

## Storage layout

```
~/.config/secret-broker/
└── <namespace-hash>/           # 16-char sha256 prefix of git root or cwd
    ├── CLOUDFLARE_API_TOKEN     # AES-GCM ciphertext, mode 0600
    ├── LINE_CHANNEL_TOKEN
    ├── .tmp/                    # `secret get` tmp files, swept after 5 min
    └── .locks/                  # request locks (auto-reaped if pid dies)
```

Keychain entry: service `secret-broker-vmk`, account `<your username>`, value = base64(32 random bytes).

---

## Using from a Claude Code agent

Drop [`skills/secure-secrets.md`](skills/secure-secrets.md) into your project (or globally) and the agent will know how to use the broker correctly:

- Never echo / cat / print secret values.
- Use `secret run NAME -- cmd` first.
- Fall back to `secret get NAME` (file path) only when env injection is impossible.
- On dialog cancellation, escalate to a different approach with the owner, don't loop.

---

## Roadmap

Things explicitly punted from v1 but worth considering for later versions:

- **Anti-phishing verification code** — show a 4-digit code in both the dialog and the calling CLI to prevent rogue local processes from showing fake dialogs.
- **TTL / killswitch** — `secret revoke --all` to wipe all decryptable secrets instantly when an agent goes rogue.
- **Linux / Windows ports** — abstract the dialog (`zenity` / PowerShell) and Keychain (`libsecret` / Credential Manager).
- **1Password / Bitwarden fallback** — `secret get` looks in OS Keychain first, then in 1P/BW vault for team-shared values.

---

## Development

```bash
git clone https://github.com/<you>/secret-broker.git
cd secret-broker
npm install
npm test                  # 80 tests
npm run build
npm run typecheck
```

The codebase is small (under 1000 lines), zero runtime dependencies, and structured to be easy to fork. Each module has a focused unit test file — see `test/`.

---

## License

MIT — use it, fork it, distribute it. See [`LICENSE`](LICENSE).
