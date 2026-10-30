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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { CurrentUser, CurrentWorkspace, type WorkspaceContext } from '../http/request.js';
import { uuidParam, ZodPipe } from '../http/zod.pipe.js';
import { WorkspaceGuard } from '../tenancy/workspace.guard.js';
import {
  createNoteSchema,
  createTaskSchema,
  listNotesSchema,
  listTasksSchema,
  updateNoteSchema,
  updateTaskSchema,
  type CreateNoteInput,
  type CreateTaskInput,
  type ListNotesInput,
  type ListTasksInput,
  type UpdateNoteInput,
  type UpdateTaskInput,
} from './crm.schemas.js';
import { NotesService } from './notes.service.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
@UseGuards(WorkspaceGuard)
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  /** Padrão: minhas tarefas abertas, por prazo, com a faixa (atrasada/hoje/semana…). */
  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listTasksSchema)) query: ListTasksInput,
  ) {
    return this.tasks.list(user, ws, query);
  }

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createTaskSchema)) body: CreateTaskInput,
  ) {
    return this.tasks.create(user, ws, body);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.tasks.get(user, ws, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateTaskSchema)) body: UpdateTaskInput,
  ) {
    return this.tasks.update(user, ws, id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.tasks.setDone(user, ws, id, true);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.tasks.setDone(user, ws, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.tasks.remove(user, ws, id);
  }
}

@Controller('notes')
@UseGuards(WorkspaceGuard)
export class NotesController {
  constructor(@Inject(NotesService) private readonly notes: NotesService) {}

  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listNotesSchema)) query: ListNotesInput,
  ) {
    return this.notes.list(user, ws, query);
  }

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createNoteSchema)) body: CreateNoteInput,
  ) {
    return this.notes.create(user, ws, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateNoteSchema)) body: UpdateNoteInput,
  ) {
    return this.notes.update(user, ws, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.notes.remove(user, ws, id);
  }
}
