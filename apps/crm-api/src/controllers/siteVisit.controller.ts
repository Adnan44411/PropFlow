import type { Request, Response } from 'express';
import { actorOf } from '../middleware/auth';
import * as svc from '../services/siteVisit.service';

export async function list(req: Request, res: Response) {
  res.json({ data: await svc.listVisits(actorOf(req), req.validatedQuery as Parameters<typeof svc.listVisits>[1]) });
}
export async function get(req: Request, res: Response) {
  res.json(await svc.getVisit(actorOf(req), Number(req.params.id)));
}
export async function create(req: Request, res: Response) {
  res.status(201).json(await svc.createVisit(actorOf(req), req.body));
}
export async function update(req: Request, res: Response) {
  res.json(await svc.updateVisit(actorOf(req), Number(req.params.id), req.body));
}
