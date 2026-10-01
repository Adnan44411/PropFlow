import type { Request, Response } from 'express';
import type { BulkActionInput, PropertyListQuery } from '@propflow/shared';
import { Errors } from '../lib/errors';
import { actorOf } from '../middleware/auth';
import * as svc from '../services/property.service';
import { streamExport } from '../services/export.service';

const id = (req: Request) => Number(req.params.id);

export async function list(req: Request, res: Response) {
  const q = req.validatedQuery as PropertyListQuery;
  const actor = actorOf(req);
  // Agents have no agent filter (their scope is fixed to themselves) — refuse rather than silently ignore.
  if (actor.role === 'AGENT' && q.assignee?.length) throw Errors.forbiddenRole('Agents cannot filter by assignee');
  res.json(await svc.listProperties(actor, q));
}

export async function exportXlsx(req: Request, res: Response) {
  await streamExport(actorOf(req), req.validatedQuery as PropertyListQuery, res);
}

export async function checkDuplicate(req: Request, res: Response) {
  const q = req.validatedQuery as { buildingName: string; unitNo: string; excludeId?: number };
  res.json(await svc.checkDuplicate(actorOf(req), q.buildingName, q.unitNo, q.excludeId));
}

export async function get(req: Request, res: Response) {
  res.json(await svc.getProperty(actorOf(req), id(req)));
}

export async function create(req: Request, res: Response) {
  res.status(201).json(await svc.createProperty(actorOf(req), req.body));
}

export async function update(req: Request, res: Response) {
  res.json(await svc.updateProperty(actorOf(req), id(req), req.body));
}

export async function remove(req: Request, res: Response) {
  await svc.deleteProperty(actorOf(req), id(req));
  res.status(204).end();
}

export async function bulk(req: Request, res: Response) {
  res.json(await svc.bulkAction(actorOf(req), req.body as BulkActionInput));
}

export async function activity(req: Request, res: Response) {
  res.json({ data: await svc.listActivity(actorOf(req), id(req)) });
}

export async function listNotes(req: Request, res: Response) {
  res.json({ data: await svc.listNotes(actorOf(req), id(req)) });
}

export async function addNote(req: Request, res: Response) {
  res.status(201).json(await svc.addNote(actorOf(req), id(req), req.body.body));
}

export async function listMessages(req: Request, res: Response) {
  res.json(await svc.listMessages(actorOf(req), id(req), req.validatedQuery as { beforeId?: number; limit: number }));
}

/** REST fallback for chat:send (same idempotency rules). 201 on first write, 200 on a retry. */
export async function sendMessage(req: Request, res: Response) {
  const result = await svc.sendMessage(actorOf(req), { propertyId: id(req), clientMsgId: req.body.clientMsgId, body: req.body.body });
  res.status(result.duplicate ? 200 : 201).json(result);
}
