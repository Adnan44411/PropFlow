import ExcelJS from 'exceljs';
import type { Response } from 'express';
import type { PropertyListQuery } from '@propflow/shared';
import { Op } from 'sequelize';
import { config } from '../config';
import { logger } from '../lib/logger';
import { Actor } from '../middleware/auth';
import { Property } from '../models';
import { userNameMap } from './identity.service';
import { getMasterMaps } from './masterData.service';
import { buildPropertyWhere } from './propertyQuery';
import { canSeeOwnerPhone, PropertyRow } from './serializers';
import { maskPhone } from '../lib/format';

const COLUMNS: Array<Partial<ExcelJS.Column>> = [
  { header: 'ID', key: 'id', width: 9 },
  { header: 'Title', key: 'title', width: 40 },
  { header: 'Type', key: 'type', width: 13 },
  { header: 'Sale/Rent', key: 'listingType', width: 10 },
  { header: 'BHK', key: 'bhk', width: 6 },
  { header: 'Furnishing', key: 'furnishing', width: 16 },
  { header: 'Status', key: 'status', width: 13 },
  { header: 'Price (₹)', key: 'priceInr', width: 15, style: { numFmt: '#,##0' } },
  { header: 'Carpet area (sq ft)', key: 'carpetAreaSqft', width: 12, style: { numFmt: '#,##0' } },
  { header: '₹ / sq ft', key: 'pricePerSqft', width: 11, style: { numFmt: '#,##0' } },
  { header: 'Building', key: 'buildingName', width: 26 },
  { header: 'Unit', key: 'unitNo', width: 8 },
  { header: 'Floor', key: 'floor', width: 7 },
  { header: 'Locality', key: 'locality', width: 18 },
  { header: 'City', key: 'city', width: 12 },
  { header: 'Owner', key: 'ownerName', width: 20 },
  { header: 'Owner phone', key: 'ownerPhone', width: 14 },
  { header: 'Assignee', key: 'assignee', width: 16 },
  { header: 'Stale', key: 'isStale', width: 7 },
  { header: 'Created (UTC)', key: 'createdAt', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
  { header: 'Updated (UTC)', key: 'updatedAt', width: 20, style: { numFmt: 'yyyy-mm-dd hh:mm' } },
];

/**
 * GET /properties/export — same filters as the list, ALL matching rows.
 * Memory stays flat: ExcelJS streaming WorkbookWriter piped straight into the response,
 * rows read in keyset-paginated batches (id > lastId, LIMIT n) and committed one by one,
 * and we wait for 'drain' when the socket is back-pressured.
 */
export async function streamExport(actor: Actor, q: Partial<PropertyListQuery>, res: Response): Promise<number> {
  const [maps, users] = await Promise.all([getMasterMaps(actor.tenantId), userNameMap(actor.tenantId)]);
  const where = buildPropertyWhere(actor, q, maps);
  const total = await Property.count({ where });

  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="propflow-properties-${stamp}.xlsx"`);
  res.setHeader('X-Total-Count', String(total));
  res.setHeader('Cache-Control', 'no-store');

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
  workbook.creator = 'PropFlow';
  const sheet = workbook.addWorksheet('Properties', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).commit();

  let aborted = false;
  res.on('close', () => {
    if (!res.writableFinished) aborted = true;
  });

  let lastId = 0;
  let written = 0;
  const started = Date.now();
  for (;;) {
    if (aborted) break;
    const batch = (await Property.findAll({
      where: { [Op.and]: [where, { id: { [Op.gt]: lastId } }] },
      order: [['id', 'ASC']],
      limit: config.EXPORT_BATCH_SIZE,
      raw: true,
    })) as unknown as PropertyRow[];
    if (batch.length === 0) break;
    for (const p of batch) {
      const price = Number(p.priceInr);
      sheet
        .addRow({
          id: Number(p.id),
          title: p.title,
          type: maps.types.get(p.typeId)?.name ?? '',
          listingType: p.listingType,
          bhk: p.bhk,
          furnishing: p.furnishing,
          status: maps.statuses.get(p.statusId)?.name ?? '',
          priceInr: price,
          carpetAreaSqft: p.carpetAreaSqft,
          pricePerSqft: p.carpetAreaSqft ? Math.round(price / p.carpetAreaSqft) : null,
          buildingName: p.buildingName,
          unitNo: p.unitNo,
          floor: p.floor,
          locality: maps.localities.get(p.localityId)?.name ?? '',
          city: p.city,
          ownerName: p.ownerName,
          ownerPhone: canSeeOwnerPhone(actor, p) ? p.ownerPhone : maskPhone(p.ownerPhone),
          assignee: p.assigneeId ? (users.get(p.assigneeId) ?? '') : '',
          isStale: p.isStale ? 'Yes' : '',
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
        })
        .commit();
    }
    written += batch.length;
    lastId = Number(batch[batch.length - 1].id);
    if (res.writableNeedDrain) await new Promise<void>((resolve) => res.once('drain', () => resolve()));
    if (batch.length < config.EXPORT_BATCH_SIZE) break;
  }
  sheet.commit();
  if (!aborted) await workbook.commit();
  logger.info('export finished', { rows: written, total, ms: Date.now() - started, aborted, rssMb: Math.round(process.memoryUsage().rss / 1e6) });
  return written;
}
