export const PANEL_PIN = process.env.PANEL_PIN ? String(process.env.PANEL_PIN).trim() : '';

export function pinMiddleware(req, res, next) {
  // Endpoints públicos de validação de PIN
  const fullPath = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
  if (
    fullPath === '/api/panel/verify' ||
    fullPath === '/api/panel/config' ||
    req.path === '/panel/verify' ||
    req.path === '/panel/config'
  ) {
    return next();
  }

  // Se nenhum PIN estiver configurado no servidor, acesso liberado
  if (!PANEL_PIN) {
    return next();
  }

  const providedPin = req.headers['x-panel-pin'] || req.query?.pin;
  if (!providedPin || String(providedPin).trim() !== PANEL_PIN) {
    return res.status(401).json({ error: 'PIN de acesso inválido ou obrigatório' });
  }

  next();
}
