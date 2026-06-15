---
name: secure-secrets
description: Use whenever you need an API token, key, password, or any secret to perform a task. The owner has installed `secret-broker` — request the secret through it, never ask via chat. Triggers on any tool needing a credential (wrangler, gh, gcloud, curl with auth, etc.) and on any user request that implies handling secrets.
---

# secure-secrets

You are working with an owner who has installed [secret-broker](https://github.com/) (a local secret broker). When a task needs an API token, key, password, or other credential, **never ask for the value in chat** and **never read it from a `.env` file**. Use the broker.

## Three rules — non-negotiable

1. **Never put a secret value in chat, stdout, stderr, logs, or any file the user can later open and see.** Not even abbreviated. Not even "for confirmation". The secret stays inside the broker → child process boundary, end of story.
2. **Use `secret run` as your first choice.** Env injection leaves no readable artifact.
3. **On user cancellation (exit code 2), stop and escalate to the user via chat.** Don't retry the dialog; the owner just told you "no". Explain what you needed and ask how to proceed.

## When to request

The instant you realise a tool you're about to run needs an authenticated value (`CLOUDFLARE_API_TOKEN`, `OPENAI_API_KEY`, `GH_TOKEN`, etc.), and that value is not already in the broker, request it.

```bash
secret ls --json
```

shows you what's already stored in the current project's namespace. If the name you need isn't there, request it:

```bash
secret request CLOUDFLARE_API_TOKEN --why "Deploy the Worker for this project"
```

The owner sees a native dialog with the name + why. They type the value (or cancel).

## How to use a stored secret

### Preferred: `secret run` (env injection)

```bash
secret run CLOUDFLARE_API_TOKEN -- wrangler deploy
```

The secret is injected into the spawned process's environment only. It never appears on disk, stdout, argv, or your chat context. Use this for every tool that accepts the credential via env var.

Multiple secrets at once:

```bash
secret run LINE_CHANNEL_ACCESS_TOKEN,LINE_CHANNEL_SECRET -- node ./scripts/push.mjs
```

### Fallback: `secret get` (only when env injection is impossible)

Some tools insist on a credentials file (e.g. `gcloud auth activate-service-account --key-file=...`). Use `secret get` to materialise a mode-0600 file and pass its path to the tool:

```bash
KEY_FILE=$(secret get GCP_SERVICE_ACCOUNT)
gcloud auth activate-service-account --key-file="$KEY_FILE"
rm -f "$KEY_FILE"   # delete immediately after use; the janitor sweeps abandoned ones after 5 min but explicit is better
```

**Never read the file with `cat`, `head`, `tail` or print its contents.** You read it only by passing the path to the tool that needs it.

## Forbidden patterns

These are silent leaks. If you find yourself reaching for any of them, stop:

- ❌ `echo $CLOUDFLARE_API_TOKEN`
- ❌ `cat $(secret get FOO)` or `head ...` or `tail ...`
- ❌ Writing the value into a `.env`, a config file, or a comment.
- ❌ Including the value (even partially) in a commit, a PR description, an issue, or chat output.
- ❌ Asking the user "paste the token here" in chat.
- ❌ Using `secret get` when `secret run` would work — env injection beats file-based delivery.

## When the dialog is cancelled

If `secret request` exits with code 2, the owner deliberately said no. Don't:

- Re-run the same `secret request`.
- Try to get the value some other way (env var, `.env`, asking in chat).

Do:

- Stop the current task.
- Tell the owner in chat what you needed and why, and ask how they'd like to proceed (different credential? skip this step? do this part manually?).

## Coexistence with other secret tooling

If the execution environment has provided a different secret-delivery mechanism (a different broker, an OS-integrated keychain wrapper, a per-tool credential helper) that takes priority — follow that one and ignore this skill. Don't run two systems in parallel; ambiguity creates leaks. If unsure which to use, ask the owner.

## Quick reference

```bash
secret ls --json                                # discover what's available
secret request NAME --why "<short reason>"      # ask owner for a new one (dialog)
secret run NAME -- <cmd>                        # use it (preferred)
secret run NAME1,NAME2 -- <cmd>                 # multiple at once
secret get NAME                                 # mode-600 path file (fallback only)
```

Storage layout (informational; you should never need to look in here directly):
```
~/.config/secret-broker/<ns>/<NAME>     # encrypted blob, mode 0600
```

Namespace is per project (git root or cwd). Secrets from another project are invisible.
