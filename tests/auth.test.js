import request from 'supertest';
import express from 'express';
import { authMiddleware } from '../src/auth.js';

function makeApp() {
  const app = express();
  app.use(authMiddleware);
  app.get('/api/test', (req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => { process.env.MCP_API_KEY = 'secret123'; });

test('rejects unauthenticated requests with 401', async () => {
  const res = await request(makeApp()).get('/api/test');
  expect(res.status).toBe(401);
});

test('allows request with valid API key', async () => {
  const res = await request(makeApp()).get('/api/test').set('Authorization', 'Bearer secret123');
  expect(res.status).toBe(200);
});

test('allows request with Azure AD Easy Auth header', async () => {
  const principal = Buffer.from(JSON.stringify({ userId: 'user1' })).toString('base64');
  const res = await request(makeApp()).get('/api/test').set('X-MS-CLIENT-PRINCIPAL', principal);
  expect(res.status).toBe(200);
});

test('rejects wrong API key with 401', async () => {
  const res = await request(makeApp()).get('/api/test').set('Authorization', 'Bearer wrongkey');
  expect(res.status).toBe(401);
});
