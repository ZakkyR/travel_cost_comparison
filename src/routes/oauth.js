// src/routes/oauth.js
import { Router } from 'express';
import fetch from 'node-fetch';

export function createOAuthRouter() {
  const router = Router();

  router.get('/oauth-authorization-server', (req, res) => {
    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
    });
  });

  return router;
}

export function authorizeHandler(req, res) {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const params = new URLSearchParams(req.query);
  params.set('client_id', clientId);
  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
}

export async function tokenHandler(req, res) {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  try {
    const body = new URLSearchParams({ ...req.body, client_id: clientId, client_secret: clientSecret });
    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
    );
    res.status(response.status).json(await response.json());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
