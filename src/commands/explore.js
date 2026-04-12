import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createExplorerServer } from '../server/api.js';
import { openSessionInAgent } from '../core/resume-service.js';

/**
 * @param {string} commandLine
 */
function parseCommandLine(commandLine) {
  const parts =
    commandLine.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map((part) => {
      if (
        (part.startsWith('"') && part.endsWith('"')) ||
        (part.startsWith("'") && part.endsWith("'"))
      ) {
        return part.slice(1, -1);
      }
      return part;
    }) ?? [];
  if (parts.length === 0) {
    throw new Error('PICKLEJAR_BROWSER is empty');
  }
  return { command: parts[0], args: parts.slice(1) };
}

/**
 * @param {string} command
 * @param {string[]} args
 */
function spawnDetached(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * @param {string} url
 */
function openBrowser(url) {
  const custom = process.env.PICKLEJAR_BROWSER?.trim();
  if (custom) {
    const { command, args } = parseCommandLine(custom);
    return spawnDetached(command, [...args, url]);
  }
  if (process.platform === 'win32') {
    return spawnDetached('cmd', ['/c', 'start', '', url]);
  }
  if (process.platform === 'darwin') {
    return spawnDetached('open', [url]);
  }
  return spawnDetached('xdg-open', [url]);
}

/**
 * @param {import('commander').Command} program
 */
export function registerExploreCommand(program) {
  const exploreCmd = program
    .command('explore')
    .description('Start a local web UI to browse sessions')
    .argument('[dir]', 'project directory', process.cwd())
    .option('--port <port>', 'HTTP port (default: random local, 19433 when remote)')
    .option('--remote', 'listen for remote access; do not open a browser');

  exploreCmd.action(async (dir) => {
    const opts = exploreCmd.opts();
    const projectDir = path.resolve(dir);
    const remote =
      Boolean(opts.remote) || process.env.PICKLEJAR_REMOTE === '1';
    const envPort = process.env.PICKLEJAR_PORT;
    let port = opts.port != null && opts.port !== '' ? Number(opts.port) : envPort ? Number(envPort) : NaN;
    if (Number.isNaN(port) || port < 0) {
      port = remote ? 19433 : 0;
    }
    const explorerToken = randomUUID();

    /** @type {import('node:http').Server} */
    let server;
    let handoffInFlight = false;

    const handoffToAgent = async (request) => {
      if (handoffInFlight) return;
      handoffInFlight = true;
      console.log(`Explorer handing off session ${request.sessionId} to ${request.agent}...`);
      await new Promise((resolve) => server.close(() => resolve(undefined)));
      await openSessionInAgent({
        ...request,
        onInjected: (injected) => {
          if (injected) {
            console.log('Resume context injected for', request.agent);
          }
        },
      });
    };

    server = await createExplorerServer(projectDir, {
      onOpenRequest: handoffToAgent,
      ephemeral: {
        token: explorerToken,
        onShutdown: async (reason) => {
          if (handoffInFlight) return;
          console.log(`Picklejar Explorer closed (${reason}).`);
          process.exit(0);
        },
      },
    });

    const listenHost = remote ? '0.0.0.0' : '127.0.0.1';
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, listenHost, () => resolve(undefined));
    });

    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    const actualPort = addr.port;
    const localUrl = `http://127.0.0.1:${actualPort}/?token=${encodeURIComponent(explorerToken)}`;
    if (remote) {
      console.log(`Picklejar Explorer listening on 0.0.0.0:${actualPort}`);
      console.log(`Explorer token: ${explorerToken}`);
    }
    console.log(`Picklejar Explorer running at ${localUrl}`);
    console.log('Press Ctrl+C to stop.');

    if (!remote) {
      try {
        await openBrowser(localUrl);
      } catch {
        /* ignore browser launch failures */
      }
    }

    const shutdown = () => {
      server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}
