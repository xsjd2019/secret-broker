# Design notes

This document captures the design decisions behind `secret-broker`. For day-to-day usage see [`README.md`](../README.md); for the agent-facing contract see [`skills/secure-secrets.md`](../skills/secure-secrets.md).

## Goals

1. Pass API tokens/keys to AI agents without ever exposing the values to chat, shell history, terminal scrollback, logs, or `.env` files.
2. Encrypt secrets at rest. Decryption requires both the encrypted file *and* the OS Keychain master key — neither alone is sufficient.
3. Single-machine, single-user use. No server, no daemon, no cross-device sync.
4. Zero runtime dependencies — Node stdlib only, so the supply chain is auditable in a single afternoon.
5. Testable: every module has unit tests; security-sensitive paths (env injection, mode 0600, AAD binding) have integration tests.

## Plaintext lifecycle (the rule that drives everything else)

- **At rest** — zero plaintext. The value exists on disk only as AES-256-GCM `v2:` ciphertext. The decryption key lives in the macOS Keychain (`security` CLI), a separate store. File leakage alone yields nothing.
- **In use** — plaintext is transient. `secret run` decrypts the value, places it in the child process's environment, and the parent immediately drops it. `secret get` writes a mode-0600 file in `~/.config/secret-broker/<ns>/.tmp/` whose path is the only thing the agent ever sees on stdout.
- **In transit (input)** — plaintext exists only inside the AppleScript `display dialog` (hidden answer) → osascript → CLI process pipeline. It never lands in any shell history, log, or chat.

This lifecycle is the design's spine. Every architectural choice that follows is in service of preserving it.

## Three primitives

### 1. Vault Master Key (VMK)

A single 32-byte AES key stored in the macOS Keychain under service `secret-broker-vmk`, account `<unix username>`. Generated on first use via `randomBytes(32)`.

**Why a master key instead of one Keychain item per secret?**

If every secret were its own Keychain item, an agent that can shell out to `security` (which it can, the same way it can `ls`) could run `security dump-keychain` and walk away with names + values for *every* item. With a single VMK, dumping the Keychain yields one 32-byte base64 blob with no metadata about what it unlocks. To turn that into actual secrets, the attacker still needs to read the encrypted files *and* know the AAD binding scheme. Defense in depth, in exchange for one extra layer of code.

**Fail-closed.** If `security` cannot persist the VMK on first run (sandboxed context, "User interaction is not allowed", permission denied), the CLI throws and refuses to proceed. There is no fallback to a plaintext key file. This is intentional and documented in §6 of the design.

### 2. AES-256-GCM `v2:` format

```
v2:  base64( VMKFingerprint(4) || IV(12) || Ciphertext || GCM_Tag(16) )
```

- **AEAD (AES-256-GCM)** — confidentiality + integrity in one primitive. Tampering with the ciphertext or tag yields a clean auth-tag failure on decrypt.
- **IV(12)** — `randomBytes(12)` per encryption. Encrypting the same plaintext twice produces different ciphertext (verified in `test/crypto.test.ts`).
- **VMK fingerprint(4)** — first 4 bytes of `sha256(VMK)`. If the VMK has been rotated (or accidentally regenerated), decrypt fails fast with `VMK fingerprint mismatch` instead of a generic `unsupported state` error. Without this byte prefix, the failure mode is hard to diagnose.
- **AAD = `<namespace>:<name>:v2`** — binds the ciphertext to its slot. Renaming a file in `~/.config/secret-broker/<ns>/` to point at a different name causes decrypt to fail (verified in `test/crypto.test.ts` — *throws on AAD mismatch*).

**`v1:` is read-only.** The v1 format (no AAD, no fingerprint) is decryptable for migration purposes only. New writes are always v2.

### 3. Deliver-by-reference

The agent must never receive a raw value back from the CLI on stdout. The two delivery modes are:

- **`secret run NAME -- cmd`** — decrypt, set `env[NAME]`, `spawnSync(cmd, args, { stdio: 'inherit', env })`. The value lives in the child's environment block, which is process memory only. It is not visible to `ps`, not on argv, not in `/proc/<pid>/cmdline`.
- **`secret get NAME`** — decrypt, `write600(<ns>/.tmp/<NAME>.<unixMs>.<pid>, plaintext)`, print the path to stdout. The agent reads the file by passing the path to the consuming tool (`--key-file=$KEY_FILE`), not by `cat`ing it. The janitor (see below) sweeps abandoned tmp files after 5 minutes.

The `secure-secrets` skill (which agents load) explicitly forbids `echo`/`cat`/`print` on secret values and the `get` tmp path content.

## Namespace = project, not directory

`resolveNamespace(cwd)` walks up from `cwd` looking for a git repo. If found, the namespace is `sha256(realpath(git-root)).slice(0,16)`. Otherwise it falls back to `sha256(realpath(cwd))`.

**Why git root?** Because `/my/project/sub/dir` and `/my/project/other/sub` are conceptually the same project. Falling back to cwd would split a project's secrets across sub-directories, which is both annoying and a foot-gun (you might `secret request CF_TOKEN` in two sub-dirs and end up with two different values).

**Why hash instead of using the path directly?** Two reasons. First, directory names with spaces / unicode would need escaping everywhere. Second, the hash is short (16 hex chars) and constant length, which keeps the layout predictable.

Sub-directories of the same repo (verified in `test/namespace.test.ts`) collapse to one namespace. Different repos (or unrelated cwds) get different namespaces. An agent running in `/proj-A` cannot see `/proj-B`'s secrets because they're in a different sub-directory of `~/.config/secret-broker/` *and* their ciphertext is AAD-bound to a different `<ns>:<name>:v2` string.

## Concurrent request prevention (lock files)

If two agents in the same project both call `secret request CF_TOKEN` simultaneously, two dialogs would pop up. The owner clicks one — what happens to the other? Undefined, confusing, and a foot-gun for testing later: "did I cancel one or both?".

`withLock(lockPath, fn)` uses `open(path, 'wx')` (O_EXCL) for atomic creation. If the file already exists:
- Read the holder pid. If `process.kill(pid, 0)` says it's alive → throw `LockBusyError`. The CLI prints a clear message and exits.
- If the pid is dead → reap the file and proceed (handles "agent crashed mid-request").

This is per-`<name>`-lock, not global, so two different secrets can be requested in parallel.

## Janitor (stale `get` artifacts)

Every CLI invocation runs `sweepStaleTmp(<ns>/.tmp/, 5min)`. The sweep is defensive:
- Only files matching `^[A-Za-z0-9_.-]+\.\d{10,16}\.\d+$` are eligible.
- A file under that pattern is deleted only if its mtime is older than 5 minutes.

The pattern match is deliberate: if a user (or another tool) puts unrelated files in this directory, the janitor leaves them alone.

## Things deliberately out of scope

- **Mint / issue / rotate.** This is a *supply* tool — it preserves human-provided values. Issuing minimal-privilege short-lived tokens against a master credential is a different layer that could sit *on top of* this broker (where the master credential itself is one entry in the broker, and a `secret mint <provider> <scope>` command wraps it). Not in v1.
- **Cross-machine sync.** When the input machine and the use machine differ, you need envelope encryption against a per-device public key and a relay. Out of scope; the design is single-machine.
- **TTL / lease / killswitch.** Worth doing in v2 (`secret revoke --all` wipes all decryptable ciphertexts; lease metadata files give per-secret expiry). Punted to keep v1 small.
- **Audit log UI.** A `~/.config/secret-broker/audit.jsonl` of `{ts, ns, name, op, pid}` (no values, ever) would be cheap; deferred until there's a real need.
- **Linux / Windows.** Dialog (`zenity` / PowerShell) and Keychain (`libsecret` / Credential Manager) are abstractable. Deferred until a Linux/Windows user needs it.
- **Anti-phishing verification code.** Showing a 4-digit code in both the dialog and the calling CLI prevents a rogue local process from spoofing the dialog. Worthwhile if the threat model includes other local processes; punted for v1 because the primary threat is "leak via shell history / chat", not "local malware".

## Testing strategy

- Unit tests per module (`test/<module>.test.ts`). Pure logic (crypto, namespace, store paths) is straightforward to cover. I/O-heavy modules inject runners (`SecurityRun`, `DialogRunner`) for testability.
- Integration tests (`test/integration.test.ts`) cover end-to-end invariants: round-trip via the store, mode 0600 on encrypted files, AAD binding across namespaces, `run` injecting env vars to a child, `ls` never printing values, etc.
- The dialog itself is not exercised in CI (osascript is macOS-only and interactive). Manual testing is required to verify the dialog flow on a fresh machine.

## Why no runtime dependencies?

A secret broker that you don't fully trust is worse than no broker at all. By keeping the runtime to Node stdlib only (`node:crypto`, `node:child_process`, `node:fs`, `node:path`, `node:os`), the entire surface that handles your secrets is reviewable. The supply chain consists of Node itself and `tsc`/`tsx`/`vitest` at dev time only.
