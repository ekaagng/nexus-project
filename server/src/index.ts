import 'dotenv/config';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config);
  const app = await buildApp(config, pool);

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, 'NEXUS API started');
  } catch (error) {
    app.log.error(error, 'Unable to start NEXUS API');
    await app.close();
    process.exitCode = 1;
  }
}

void main();
