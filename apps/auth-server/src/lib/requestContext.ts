import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  userId?: number;
  tenantId?: number | null;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const currentRequestId = (): string | undefined => requestContext.getStore()?.requestId;
