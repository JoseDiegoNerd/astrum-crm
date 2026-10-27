import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { CurrentUser, CurrentWorkspace, type WorkspaceContext } from '../http/request.js';
import { uuidParam, ZodPipe } from '../http/zod.pipe.js';
import { WorkspaceGuard } from '../tenancy/workspace.guard.js';
import {
  boardSchema,
  createDealSchema,
  createPipelineSchema,
  createStageSchema,
  listDealsSchema,
  moveDealSchema,
  reorderStagesSchema,
  setTagsSchema,
  updateDealSchema,
  updatePipelineSchema,
  updateStageSchema,
  type BoardInput,
  type CreateDealInput,
  type CreatePipelineInput,
  type CreateStageInput,
  type ListDealsInput,
  type MoveDealInput,
  type ReorderStagesInput,
  type SetTagsInput,
  type UpdateDealInput,
  type UpdatePipelineInput,
  type UpdateStageInput,
} from './crm.schemas.js';
import { DealsService } from './deals.service.js';
import { PipelinesService } from './pipelines.service.js';

@Controller('deals')
@UseGuards(WorkspaceGuard)
export class DealsController {
  constructor(@Inject(DealsService) private readonly deals: DealsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listDealsSchema)) query: ListDealsInput,
  ) {
    return this.deals.list(user, ws, query);
  }

  /** Kanban do pipeline (padrão se não informado). */
  @Get('board')
  board(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(boardSchema)) query: BoardInput,
  ) {
    return this.deals.board(user, ws, query);
  }

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createDealSchema)) body: CreateDealInput,
  ) {
    return this.deals.create(user, ws, body);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.deals.get(user, ws, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateDealSchema)) body: UpdateDealInput,
  ) {
    return this.deals.update(user, ws, id, body);
  }

  @Post(':id/move')
  @HttpCode(200)
  move(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(moveDealSchema)) body: MoveDealInput,
  ) {
    return this.deals.move(user, ws, id, body);
  }

  @Put(':id/tags')
  setTags(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(setTagsSchema)) body: SetTagsInput,
  ) {
    return this.deals.setTags(user, ws, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.deals.remove(user, ws, id);
  }
}

@Controller('pipelines')
@UseGuards(WorkspaceGuard)
export class PipelinesController {
  constructor(@Inject(PipelinesService) private readonly pipelines: PipelinesService) {}

  @Get()
  list(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.pipelines.list(user, ws);
  }

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createPipelineSchema)) body: CreatePipelineInput,
  ) {
    return this.pipelines.create(user, ws, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updatePipelineSchema)) body: UpdatePipelineInput,
  ) {
    return this.pipelines.update(user, ws, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.pipelines.remove(user, ws, id);
  }

  @Post(':id/stages')
  addStage(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(createStageSchema)) body: CreateStageInput,
  ) {
    return this.pipelines.addStage(user, ws, id, body);
  }

  @Post(':id/stages/reorder')
  @HttpCode(200)
  reorderStages(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(reorderStagesSchema)) body: ReorderStagesInput,
  ) {
    return this.pipelines.reorderStages(user, ws, id, body);
  }

  @Patch(':id/stages/:stageId')
  updateStage(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Param('stageId', uuidParam) stageId: string,
    @Body(new ZodPipe(updateStageSchema)) body: UpdateStageInput,
  ) {
    return this.pipelines.updateStage(user, ws, id, stageId, body);
  }

  @Delete(':id/stages/:stageId')
  removeStage(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Param('stageId', uuidParam) stageId: string,
  ) {
    return this.pipelines.removeStage(user, ws, id, stageId);
  }
}
