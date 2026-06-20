export function authMiddleware(req, res, next) {
  if (req.headers['x-ms-client-principal']) return next();

  const apiKey = process.env.MCP_API_KEY;
  const auth = req.headers['authorization'];
  if (apiKey && auth === `Bearer ${apiKey}`) return next();

  res.status(401).json({ error: 'Unauthorized' });
}
