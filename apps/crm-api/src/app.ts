import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import openapiJson from '../swagger.json';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { router } from './routes';

const openapi = openapiJson as unknown as swaggerUi.JsonObject;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.set('query parser', 'extended'); // status=1&status=2 → array
  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.webOrigins.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'X-Total-Count', 'Content-Disposition', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '200kb' }));

  app.get('/swagger.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'PropFlow crm-api' }));

  app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
