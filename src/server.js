import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';
import { createDb } from './db.js';
import { authMiddleware } from './auth.js';
import { createCompareRouter } from './routes/compare.js';
import { createStationsRouter } from './routes/stations.js';
import { createParkingsRouter } from './routes/parkings.js';
import { createSettingsRouter } from './routes/settings.js';
import { createFareRouter } from './routes/fare.js';
import { createImportRouter } from './routes/import.js';
import { createMcpRouter } from './routes/mcp.js';
import { createOAuthRouter, authorizeHandler, tokenHandler } from './routes/oauth.js';
import { initSentry } from './sentry.js';

dotenv.config();
initSentry();

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(db) {
  const app = express();
  app.use(express.json());
  Sentry.setupExpressErrorHandler(app);
  app.use(express.static(join(__dirname, 'public')));
  app.use('/api', authMiddleware);
  app.use('/api/compare', createCompareRouter(db));
  app.use('/api/stations', createStationsRouter(db));
  app.use('/api/parkings', createParkingsRouter(db));
  app.use('/api/settings', createSettingsRouter(db));
  app.use('/api/fare', createFareRouter(db));
  app.use('/api/import', createImportRouter(db));
  app.use('/mcp', authMiddleware, createMcpRouter(db));
  app.use('/.well-known', createOAuthRouter());
  app.get('/mcp-auth/authorize', authorizeHandler);
  app.post('/mcp-auth/token', express.urlencoded({ extended: false }), tokenHandler);
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DB_PATH || join(process.env.HOME || '/home', 'data', 'travel.db');
  const db = createDb(dbPath);
  const port = Number(process.env.PORT) || 3000;
  createApp(db).listen(port, () => console.log(`Server running on port ${port}`));
}
