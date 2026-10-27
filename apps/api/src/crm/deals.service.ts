import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  asc,
  companies,
  contacts,
  count,
  deals,
  desc,
  eq,
  gt,
  ilike,
  insertRows,
  min,
  ne,
  pipelineStages,
  sum,
  withUserContext,
  type Database,
  type JwtClaims,
  type SQL,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type {
  BoardInput,
  CreateDealInput,
  ListDealsInput,
  MoveDealInput,
  SetTagsInput,
  UpdateDealInput,
} from './crm.schemas.js';
import { applyCustomFields } from './custom-fields.js';
import { afterCursor, decodeCursor, likePattern, page } from './pagination.js';
import { findPipeline, pipelinesWithStages } from './pipelines.service.js';
import { fieldsOf } from './settings.service.js';
import { hasTag, replaceTags, tagsOf } from './tagging.js';

/** Máximo de cards carregados por coluna do kanban. */
const BOARD_COLUMN_LIMIT = 200;

// Colunas exibidas em listas, kanban e ficha (negócio + nomes dos vínculos).
const dealView = {
  deal: deals,
  contactName: contacts.name,
  companyName: companies.name,
  stageName: pipelineStages.name,
  stageKind: pipelineStages.kind,
};

@Injectable()
export class DealsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext, input: ListDealsInput) {
    return withUserContext(this.db, user, async (tx) => {
      const where: SQL[] = [eq(deals.workspaceId, ws.id)];
      if (input.pipeline) where.push(eq(deals.pipelineId, input.pipeline));
      if (input.stage) where.push(eq(deals.stageId, input.stage));
      if (input.status) where.push(eq(deals.status, input.status));
      if (input.owner) where.push(eq(deals.ownerId, input.owner));
      if (input.contact) where.push(eq(deals.contactId, input.contact));
      if (input.company) where.push(eq(deals.companyId, input.company));
      if (input.tag) where.push(hasTag(tx, 'deal', deals.id, input.tag));
      if (input.q) where.push(ilike(deals.title, likePattern(input.q)));
      if (input.cursor) where.push(afterCursor(deals.createdAt, deals.id, decodeCursor(input.cursor)));

      const rows = await selectDeals(tx)
        .where(and(...where))
        .orderBy(desc(deals.createdAt), desc(deals.id))
        .limit(input.limit + 1);
      const result = page(rows.map(flatten), input.limit);
      return { ...result, items: await withTags(tx, result.items) };
    });
  }

  /** Kanban: colunas do pipeline com os negócios na ordem e totais por etapa. */
  board(user: JwtClaims, ws: WorkspaceContext, input: BoardInput) {
    return withUserContext(this.db, user, async (tx) => {
      const all = await pipelinesWithStages(tx, ws);
      const pipeline = input.pipeline ? all.find((p) => p.id === input.pipeline) : all[0];
      if (!pipeline) throw new NotFoundException('Pipeline não encontrado');

      const filters = [eq(deals.workspaceId, ws.id), eq(deals.pipelineId, pipeline.id)];
      if (input.owner) filters.push(eq(deals.ownerId, input.owner));

      const totals = await tx
        .select({ stageId: deals.stageId, count: count(), totalCents: sum(deals.valueCents) })
        .from(deals)
        .where(and(...filters))
        .groupBy(deals.stageId);
      const totalsByStage = new Map(totals.map((t) => [t.stageId, t]));

      const columns = await Promise.all(
        pipeline.stages.map(async (stage) => {
          const rows = await selectDeals(tx)
            .where(and(...filters, eq(deals.stageId, stage.id)))
            .orderBy(asc(deals.position), desc(deals.createdAt))
            .limit(BOARD_COLUMN_LIMIT);
          const total = totalsByStage.get(stage.id);
          return {
            ...stage,
            count: total?.count ?? 0,
            totalCents: Number(total?.totalCents ?? 0),
            deals: await withTags(tx, rows.map(flatten)),
          };
        }),
      );

      return {
        pipelines: all.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
        pipeline: { id: pipeline.id, name: pipeline.name },
        columns,
      };
    });
  }

  get(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, (tx) => findDeal(tx, ws, id));
  }

  create(user: JwtClaims, ws: WorkspaceContext, input: CreateDealInput) {
    return withUserContext(this.db, user, async (tx) => {
      const pipelineId = input.pipelineId ?? (await pipelinesWithStages(tx, ws))[0]?.id;
      if (!pipelineId) throw new BadRequestException('O workspace não tem pipeline');
      const pipeline = await findPipeline(tx, ws, pipelineId);
      const stage = input.stageId
        ? pipeline.stages.find((s) => s.id === input.stageId)
        : (pipeline.stages.find((s) => s.kind === 'open') ?? pipeline.stages[0]);
      if (!stage) throw new BadRequestException('Etapa não pertence ao pipeline');

      const custom = applyCustomFields(await fieldsOf(tx, ws, 'deal'), input.custom ?? {});
      const [deal] = await insertRows(tx, deals, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        title: input.title,
        pipelineId: pipeline.id,
        stageId: stage.id,
        contactId: input.contactId ?? undefined,
        companyId: input.companyId ?? undefined,
        ownerId: input.ownerId ?? undefined,
        valueCents: input.valueCents,
        currency: input.currency,
        expectedCloseAt: input.expectedCloseAt ?? undefined,
        custom,
        // novo negócio entra no topo da coluna
        position: (await topPosition(tx, stage.id)) - 1,
      });
      return findDeal(tx, ws, deal!.id);
    });
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdateDealInput) {
    return withUserContext(this.db, user, async (tx) => {
      const current = await findDeal(tx, ws, id);
      const custom =
        input.custom === undefined
          ? undefined
          : applyCustomFields(await fieldsOf(tx, ws, 'deal'), input.custom, current.custom);
      const { custom: _ignored, ...rest } = input;
      await updateOrFail(tx, ws, id, { ...rest, custom });
      return findDeal(tx, ws, id);
    });
  }

  /** Move para uma etapa (do mesmo pipeline), logo abaixo de `afterDealId` ou no topo. */
  move(user: JwtClaims, ws: WorkspaceContext, id: string, input: MoveDealInput) {
    return withUserContext(this.db, user, async (tx) => {
      const deal = await findDeal(tx, ws, id);
      const pipeline = await findPipeline(tx, ws, deal.pipelineId);
      const stage = pipeline.stages.find((s) => s.id === input.stageId);
      if (!stage) throw new BadRequestException('A etapa não pertence ao pipeline do negócio');

      let position: number;
      if (!input.afterDealId) {
        position = (await topPosition(tx, stage.id, id)) - 1;
      } else {
        const [after] = await tx
          .select({ position: deals.position })
          .from(deals)
          .where(and(eq(deals.id, input.afterDealId), eq(deals.stageId, stage.id)));
        if (!after) throw new BadRequestException('O negócio de referência não está nesta etapa');
        const [next] = await tx
          .select({ position: min(deals.position) })
          .from(deals)
          .where(and(eq(deals.stageId, stage.id), gt(deals.position, after.position), ne(deals.id, id)));
        position = next?.position == null ? after.position + 1 : (after.position + next.position) / 2;
      }

      await updateOrFail(tx, ws, id, {
        stageId: stage.id,
        position,
        ...(stage.kind === 'lost' && input.lostReason !== undefined && { lostReason: input.lostReason }),
      });
      return findDeal(tx, ws, id);
    });
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      await findDeal(tx, ws, id);
      const deleted = await tx
        .delete(deals)
        .where(and(eq(deals.workspaceId, ws.id), eq(deals.id, id)))
        .returning({ id: deals.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers podem excluir negócios');
    });
  }

  setTags(user: JwtClaims, ws: WorkspaceContext, id: string, input: SetTagsInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findDeal(tx, ws, id);
      await replaceTags(tx, ws, 'deal', id, input.tagIds);
      return findDeal(tx, ws, id);
    });
  }
}

function selectDeals(tx: Transaction) {
  return tx
    .select(dealView)
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .$dynamic();
}

function flatten(row: { deal: typeof deals.$inferSelect; contactName: string | null; companyName: string | null; stageName: string; stageKind: string }) {
  return {
    ...row.deal,
    contactName: row.contactName,
    companyName: row.companyName,
    stageName: row.stageName,
  };
}

async function withTags<T extends { id: string }>(tx: Transaction, items: T[]) {
  const tagMap = await tagsOf(tx, 'deal', items.map((d) => d.id));
  return items.map((d) => ({ ...d, tags: tagMap.get(d.id) ?? [] }));
}

async function findDeal(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [row] = await selectDeals(tx)
    .where(and(eq(deals.workspaceId, ws.id), eq(deals.id, id)));
  if (!row) throw new NotFoundException('Negócio não encontrado');
  const [deal] = await withTags(tx, [flatten(row)]);
  return deal!;
}

/** Menor posição na coluna (0 se vazia), ignorando o próprio negócio. */
async function topPosition(tx: Transaction, stageId: string, exceptId?: string) {
  const [row] = await tx
    .select({ top: min(deals.position) })
    .from(deals)
    .where(and(eq(deals.stageId, stageId), exceptId ? ne(deals.id, exceptId) : undefined));
  return row?.top ?? 0;
}

async function updateOrFail(
  tx: Transaction,
  ws: WorkspaceContext,
  id: string,
  values: Partial<typeof deals.$inferInsert>,
) {
  const set = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  const updated = await tx
    .update(deals)
    .set(set)
    .where(and(eq(deals.workspaceId, ws.id), eq(deals.id, id)))
    .returning({ id: deals.id });
  if (updated.length === 0) throw new ForbiddenException('Sem permissão para editar este negócio');
}
