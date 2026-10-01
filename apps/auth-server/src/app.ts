import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { authRouter } from './routes/auth.routes';
import { platformRouter } from './routes/platform.routes';
import { systemRouter } from './routes/system.routes';
import { usersRouter } from './routes/users.routes';
import openapiJson from '../swagger.json';

const openapi = openapiJson as unknown as swaggerUi.JsonObject;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.webOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/swagger.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'PropFlow auth-server API' }));

  app.use(systemRouter);
  app.use('/auth', authRouter);
  app.use(usersRouter);
  app.use(platformRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
