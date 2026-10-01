import type { Request, Response } from 'express';
import { MASTER_DATA_KINDS, MasterDataKind, masterDataCreateSchemas, masterDataUpdateSchemas } from '@propflow/shared';
import { Errors } from '../lib/errors';
import { zodDetails } from '../middleware/validate';
import * as svc from '../services/masterData.service';

const kindOf = (req: Request) => req.params.kind as MasterDataKind;
const tenant = (req: Request) => req.tenantId;
const includeInactive = (req: Request) => req.query.includeInactive === 'true';

export async function all(req: Request, res: Response) {
  const entries = await Promise.all(MASTER_DATA_KINDS.map(async (k) => [k, await svc.listMasterData(tenant(req), k, includeInactive(req))] as const));
  res.json(Object.fromEntries(entries));
}

export async function list(req: Request, res: Response) {
  res.json({ data: await svc.listMasterData(tenant(req), kindOf(req), includeInactive(req)) });
}

export async function create(req: Request, res: Response) {
  const parsed = masterDataCreateSchemas[kindOf(req)].safeParse(req.body);
  if (!parsed.success) throw Errors.validation(zodDetails(parsed.error));
  res.status(201).json(await svc.createMasterData(tenant(req), kindOf(req), parsed.data));
}

export async function update(req: Request, res: Response) {
  const parsed = masterDataUpdateSchemas[kindOf(req)].safeParse(req.body);
  if (!parsed.success) throw Errors.validation(zodDetails(parsed.error));
  if (Object.keys(parsed.data).length === 0) throw Errors.validation({ fields: { _: 'Nothing to update' } });
  res.json(await svc.updateMasterData(tenant(req), kindOf(req), Number(req.params.id), parsed.data));
}

export async function remove(req: Request, res: Response) {
  await svc.deleteMasterData(tenant(req), kindOf(req), Number(req.params.id));
  res.status(204).end();
}

export async function reorder(req: Request, res: Response) {
  res.json({ data: await svc.reorderMasterData(tenant(req), kindOf(req), req.body.ids) });
}
