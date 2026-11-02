import { Router } from 'express';

const router = Router();

// Cancelar Tarefa em Andamento (Purge ou Limpar DM)
router.post('/tasks/:id/cancel', (req, res) => {
  const bot = req.bot;
  const taskId = req.params.id;
  const cancelled = bot.chatManager.cancelTask(taskId);

  if (cancelled) {
    res.json({ ok: true, taskId, message: 'Tarefa cancelada com sucesso' });
  } else {
    res.status(404).json({ ok: false, error: 'Tarefa não encontrada ou já finalizada' });
  }
});

export default router;
