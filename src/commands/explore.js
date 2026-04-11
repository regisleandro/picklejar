import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createExplorerServer } from '../server/api.js';
import { openSessionInAgent } from '../core/resume-service.js';

/**
 * @param {string} url
 */
function openBrowser(url) {
  return new Promise((resolve, reject) => {
    const custom = process.env.PICKLEJAR_BROWSER?.trim();
    if (custom) {
      const child = spawn(custom, [url], { shell: true, stdio: 'ignore', detached: true });
      child.unref();
      child.on('error', reject);
      resolve();
      return;
    }
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true });
      child.unref();
    } else if (process.platform === 'darwin') {
      const child = spawn('open', [url], { stdio: 'ignore', detached: true });
      child.unref();
    } else {
      const child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
      child.unref();
    }
    resolve();
  });
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

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve(undefined));
    });

    const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
    const actualPort = addr.port;
    const baseUrl = `http://127.0.0.1:${actualPort}/?token=${encodeURIComponent(explorerToken)}`;
    console.log(`Picklejar Explorer running at ${baseUrl}`);
    console.log('Press Ctrl+C to stop.');

    if (!remote) {
      try {
        await openBrowser(baseUrl);
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
