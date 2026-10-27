import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  insertRows,
  max,
  pipelineStages,
  pipelines,
  withUserContext,
  type Database,
  type JwtClaims,
  type PipelineStage,
  type Transaction,
} from '@astrum/db';
import { DATABASE } from '../database/database.module.js';
import type { WorkspaceContext } from '../http/request.js';
import type {
  CreatePipelineInput,
  CreateStageInput,
  ReorderStagesInput,
  UpdatePipelineInput,
  UpdateStageInput,
} from './crm.schemas.js';

const DEFAULT_STAGES: CreateStageInput[] = [
  { name: 'Novo', kind: 'open', probability: 10 },
  { name: 'Em andamento', kind: 'open', probability: 50 },
  { name: 'Ganho', kind: 'won', probability: 100 },
  { name: 'Perdido', kind: 'lost', probability: 0 },
];

/** Pipelines e etapas: configuração do workspace (a RLS só deixa manager escrever). */
@Injectable()
export class PipelinesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  list(user: JwtClaims, ws: WorkspaceContext) {
    return withUserContext(this.db, user, (tx) => pipelinesWithStages(tx, ws));
  }

  create(user: JwtClaims, ws: WorkspaceContext, input: CreatePipelineInput) {
    return withUserContext(this.db, user, async (tx) => {
      const [{ last } = { last: null }] = await tx
        .select({ last: max(pipelines.position) })
        .from(pipelines)
        .where(eq(pipelines.workspaceId, ws.id));
      const [pipeline] = await insertRows(tx, pipelines, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        name: input.name,
        position: (last ?? -1) + 1,
      });
      for (const [position, stage] of (input.stages ?? DEFAULT_STAGES).entries()) {
        await insertRows(tx, pipelineStages, {
          tenantId: ws.tenantId,
          workspaceId: ws.id,
          pipelineId: pipeline!.id,
          name: stage.name,
          kind: stage.kind,
          probability: stage.probability,
          position,
        });
      }
      return findPipeline(tx, ws, pipeline!.id);
    });
  }

  update(user: JwtClaims, ws: WorkspaceContext, id: string, input: UpdatePipelineInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findPipeline(tx, ws, id);
      if (input.isDefault) {
        // só um padrão por workspace (índice único parcial): desmarca o atual antes
        await tx
          .update(pipelines)
          .set({ isDefault: false })
          .where(and(eq(pipelines.workspaceId, ws.id), eq(pipelines.isDefault, true)));
      }
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const updated = await tx
        .update(pipelines)
        .set(set)
        .where(and(eq(pipelines.workspaceId, ws.id), eq(pipelines.id, id)))
        .returning({ id: pipelines.id });
      if (updated.length === 0) throw new ForbiddenException('Só managers configuram o funil');
      return findPipeline(tx, ws, id);
    });
  }

  remove(user: JwtClaims, ws: WorkspaceContext, id: string) {
    return withUserContext(this.db, user, async (tx) => {
      const pipeline = await findPipeline(tx, ws, id);
      if (pipeline.isDefault) throw new ConflictException('Defina outro pipeline como padrão antes de excluir este');
      // negócios no pipeline bloqueiam pela FK (on delete restrict) → 422
      const deleted = await tx
        .delete(pipelines)
        .where(and(eq(pipelines.workspaceId, ws.id), eq(pipelines.id, id)))
        .returning({ id: pipelines.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers configuram o funil');
    });
  }

  addStage(user: JwtClaims, ws: WorkspaceContext, pipelineId: string, input: CreateStageInput) {
    return withUserContext(this.db, user, async (tx) => {
      const pipeline = await findPipeline(tx, ws, pipelineId);
      const position = Math.max(-1, ...pipeline.stages.map((s) => s.position)) + 1;
      await insertRows(tx, pipelineStages, {
        tenantId: ws.tenantId,
        workspaceId: ws.id,
        pipelineId,
        name: input.name,
        kind: input.kind,
        probability: input.probability,
        position,
      });
      return findPipeline(tx, ws, pipelineId);
    });
  }

  updateStage(user: JwtClaims, ws: WorkspaceContext, pipelineId: string, stageId: string, input: UpdateStageInput) {
    return withUserContext(this.db, user, async (tx) => {
      await findStage(tx, ws, pipelineId, stageId);
      const set = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      const updated = await tx
        .update(pipelineStages)
        .set(set)
        .where(eq(pipelineStages.id, stageId))
        .returning({ id: pipelineStages.id });
      if (updated.length === 0) throw new ForbiddenException('Só managers configuram o funil');
      return findPipeline(tx, ws, pipelineId);
    });
  }

  removeStage(user: JwtClaims, ws: WorkspaceContext, pipelineId: string, stageId: string) {
    return withUserContext(this.db, user, async (tx) => {
      const pipeline = await findPipeline(tx, ws, pipelineId);
      if (!pipeline.stages.some((s) => s.id === stageId)) throw new NotFoundException('Etapa não encontrada');
      if (pipeline.stages.length === 1) throw new ConflictException('O pipeline precisa de pelo menos uma etapa');
      const deleted = await tx
        .delete(pipelineStages)
        .where(eq(pipelineStages.id, stageId))
        .returning({ id: pipelineStages.id });
      if (deleted.length === 0) throw new ForbiddenException('Só managers configuram o funil');
      return findPipeline(tx, ws, pipelineId);
    });
  }

  reorderStages(user: JwtClaims, ws: WorkspaceContext, pipelineId: string, input: ReorderStagesInput) {
    return withUserContext(this.db, user, async (tx) => {
      const pipeline = await findPipeline(tx, ws, pipelineId);
      const current = new Set(pipeline.stages.map((s) => s.id));
      if (input.stageIds.length !== current.size || !input.stageIds.every((id) => current.has(id))) {
        throw new ConflictException('Informe todas as etapas do pipeline, uma vez cada');
      }
      for (const [position, id] of input.stageIds.entries()) {
        const updated = await tx
          .update(pipelineStages)
          .set({ position })
          .where(eq(pipelineStages.id, id))
          .returning({ id: pipelineStages.id });
        if (updated.length === 0) throw new ForbiddenException('Só managers configuram o funil');
      }
      return findPipeline(tx, ws, pipelineId);
    });
  }
}

/** Pipelines do workspace (padrão primeiro) com as etapas em ordem. */
export async function pipelinesWithStages(tx: Transaction, ws: WorkspaceContext, onlyId?: string) {
  const rows = await tx
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.workspaceId, ws.id), onlyId ? eq(pipelines.id, onlyId) : undefined))
    .orderBy(desc(pipelines.isDefault), asc(pipelines.position), asc(pipelines.name));
  const stages = rows.length
    ? await tx
        .select()
        .from(pipelineStages)
        .where(inArray(pipelineStages.pipelineId, rows.map((p) => p.id)))
        .orderBy(asc(pipelineStages.position), asc(pipelineStages.createdAt))
    : [];
  const byPipeline = new Map<string, PipelineStage[]>();
  for (const stage of stages) byPipeline.set(stage.pipelineId, [...(byPipeline.get(stage.pipelineId) ?? []), stage]);
  return rows.map((p) => ({ ...p, stages: byPipeline.get(p.id) ?? [] }));
}

export async function findPipeline(tx: Transaction, ws: WorkspaceContext, id: string) {
  const [pipeline] = await pipelinesWithStages(tx, ws, id);
  if (!pipeline) throw new NotFoundException('Pipeline não encontrado');
  return pipeline;
}

async function findStage(tx: Transaction, ws: WorkspaceContext, pipelineId: string, stageId: string) {
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.workspaceId, ws.id),
        eq(pipelineStages.pipelineId, pipelineId),
        eq(pipelineStages.id, stageId),
      ),
    );
  if (!stage) throw new NotFoundException('Etapa não encontrada');
  return stage;
}
