import { Router } from 'express';
import authRoutes from './auth.routes.js';
import voiceRoutes from './voice.routes.js';
import featuresRoutes from './features.routes.js';
import chatRoutes from './chat.routes.js';
import factoryRoutes from './factory.routes.js';
import tasksRoutes from './tasks.routes.js';
import debugRoutes from './debug.routes.js';

const apiRouter = Router();

apiRouter.use(authRoutes);
apiRouter.use(voiceRoutes);
apiRouter.use(featuresRoutes);
apiRouter.use(chatRoutes);
apiRouter.use(factoryRoutes);
apiRouter.use(tasksRoutes);
apiRouter.use(debugRoutes);

export default apiRouter;
