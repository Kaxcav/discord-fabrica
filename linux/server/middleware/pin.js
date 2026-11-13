export const PANEL_PIN = process.env.PANEL_PIN ? String(process.env.PANEL_PIN).trim() : '';

export function pinMiddleware(req, res, next) {
  // Endpoints públicos — req.path é relativo a /api quando montado em /api
  if (req.path === '/panel/verify' || req.path === '/panel/config') {
    return next();
  }

  // Ponte IPC local autentica via ID de usuário da sessão ativa / requestId
  if (req.headers['x-ipc-bridge'] === '1' && req.path.startsWith('/voice/ipc-')) {
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
