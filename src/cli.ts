#!/usr/bin/env node
import { bootstrap } from './context.js';
import { setSecret } from './commands/set.js';
import { runWithSecrets } from './commands/run.js';
import { getSecret } from './commands/get.js';
import { listSecrets } from './commands/ls.js';
import { removeSecret } from './commands/rm.js';
import { importEnv } from './commands/import-env.js';
import { EXIT_ERROR, EXIT_OK } from './exit-codes.js';

const VERSION = '0.1.0';

const HELP = `secret — local secret broker (v${VERSION})

USAGE:
  secret request <NAME> --why "<text>"   # agent asks owner via dialog
  secret set <NAME>                       # owner sets via dialog
  secret run <NAME[,NAME2,...]> -- <cmd>  # exec <cmd> with secret(s) as env
  secret get <NAME>                       # write mode-600 tmp file, print path
  secret ls [--json]                      # list names in current namespace
  secret rm <NAME>                        # delete a secret
  secret import-env <path>                # bulk import a .env file
  secret help | --version

Secrets are scoped to the current git repo (or cwd). Values never appear
on stdout (except for the path that 'get' returns), in argv, in process
listings, or in the shell history. They live encrypted on disk under
~/.config/secret-broker/<ns>/<name>, decryptable only with the master
key stored in the macOS Keychain.
`;

function parseRunArgs(argv: string[]): {
  names: string[];
  cmd: string;
  cmdArgs: string[];
} | null {
  const sepIdx = argv.indexOf('--');
  if (sepIdx < 0 || sepIdx === 0 || sepIdx === argv.length - 1) return null;
  const namesArg = argv[0];
  if (!namesArg) return null;
  const names = namesArg.split(',').map((s) => s.trim()).filter(Boolean);
  if (names.length === 0) return null;
  const cmdParts = argv.slice(sepIdx + 1);
  const cmd = cmdParts[0];
  if (!cmd) return null;
  return { names, cmd, cmdArgs: cmdParts.slice(1) };
}

function getFlag(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  return argv[i + 1];
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    return EXIT_OK;
  }
  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(VERSION + '\n');
    return EXIT_OK;
  }

  const sub = argv[0];
  const rest = argv.slice(1);

  switch (sub) {
    case 'request': {
      const name = rest[0];
      const why = getFlag(rest, '--why');
      if (!name || !why) {
        process.stderr.write('usage: secret request <NAME> --why "<text>"\n');
        return EXIT_ERROR;
      }
      const ctx = bootstrap();
      return await setSecret({ name, why, ctx });
    }
    case 'set': {
      const name = rest[0];
      if (!name) {
        process.stderr.write('usage: secret set <NAME>\n');
        return EXIT_ERROR;
      }
      const why = getFlag(rest, '--why') ?? 'manual entry by owner';
      const ctx = bootstrap();
      return await setSecret({ name, why, ctx });
    }
    case 'run': {
      const parsed = parseRunArgs(rest);
      if (!parsed) {
        process.stderr.write(
          'usage: secret run <NAME[,N2,...]> -- <cmd> [args...]\n',
        );
        return EXIT_ERROR;
      }
      const ctx = bootstrap();
      return runWithSecrets({ ...parsed, ctx });
    }
    case 'get': {
      const name = rest[0];
      if (!name) {
        process.stderr.write('usage: secret get <NAME>\n');
        return EXIT_ERROR;
      }
      const ctx = bootstrap();
      return getSecret({ name, ctx });
    }
    case 'ls': {
      const json = rest.includes('--json');
      const ctx = bootstrap();
      return listSecrets({ ctx, json });
    }
    case 'rm': {
      const name = rest[0];
      if (!name) {
        process.stderr.write('usage: secret rm <NAME>\n');
        return EXIT_ERROR;
      }
      const ctx = bootstrap();
      return removeSecret({ name, ctx });
    }
    case 'import-env': {
      const path = rest[0];
      if (!path) {
        process.stderr.write('usage: secret import-env <path>\n');
        return EXIT_ERROR;
      }
      const ctx = bootstrap();
      return importEnv({ path, ctx });
    }
    default:
      process.stderr.write(`unknown command: ${sub}\nrun 'secret help' for usage\n`);
      return EXIT_ERROR;
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`fatal: ${(e as Error).message}\n`);
    process.exit(EXIT_ERROR);
  });
