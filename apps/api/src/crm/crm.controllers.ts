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
import { CompaniesService } from './companies.service.js';
import { ContactsService } from './contacts.service.js';
import {
  createCompanySchema,
  createContactSchema,
  identityInputSchema,
  importContactsSchema,
  type ImportContactsInput,
  listCompaniesSchema,
  listContactsSchema,
  updateCompanySchema,
  updateContactSchema,
  updateIdentitySchema,
  createFieldSchema,
  createTagSchema,
  listFieldsSchema,
  setTagsSchema,
  updateFieldSchema,
  updateTagSchema,
  type CreateFieldInput,
  type CreateTagInput,
  type ListFieldsInput,
  type SetTagsInput,
  type UpdateFieldInput,
  type UpdateTagInput,
  type CreateCompanyInput,
  type CreateContactInput,
  type IdentityInput,
  type ListCompaniesInput,
  type ListContactsInput,
  type UpdateCompanyInput,
  type UpdateContactInput,
} from './crm.schemas.js';
import { ImportService } from './import.service.js';
import { SettingsService } from './settings.service.js';

// Rotas de workspace: exigem o header X-Workspace-Id.

@Controller('contacts')
@UseGuards(WorkspaceGuard)
export class ContactsController {
  constructor(
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(ImportService) private readonly importer: ImportService,
  ) {}

  /** Importa contatos de um CSV; devolve o relatório linha a linha. */
  @Post('import')
  @HttpCode(200)
  import(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(importContactsSchema)) body: ImportContactsInput,
  ) {
    return this.importer.importContacts(user, ws, body);
  }

  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listContactsSchema)) query: ListContactsInput,
  ) {
    return this.contacts.list(user, ws, query);
  }

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createContactSchema)) body: CreateContactInput,
  ) {
    return this.contacts.create(user, ws, body);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.contacts.get(user, ws, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateContactSchema)) body: UpdateContactInput,
  ) {
    return this.contacts.update(user, ws, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.contacts.setArchived(user, ws, id, true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.contacts.setArchived(user, ws, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.contacts.remove(user, ws, id);
  }

  /** Substitui as tags do contato pelas informadas. */
  @Put(':id/tags')
  setTags(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(setTagsSchema)) body: SetTagsInput,
  ) {
    return this.contacts.setTags(user, ws, id, body);
  }

  @Post(':id/identities')
  addIdentity(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(identityInputSchema)) body: IdentityInput,
  ) {
    return this.contacts.addIdentity(user, ws, id, body);
  }

  @Patch(':id/identities/:identityId')
  makePrimary(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Param('identityId', uuidParam) identityId: string,
    @Body(new ZodPipe(updateIdentitySchema)) _body: unknown,
  ) {
    return this.contacts.makePrimary(user, ws, id, identityId);
  }

  @Delete(':id/identities/:identityId')
  removeIdentity(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Param('identityId', uuidParam) identityId: string,
  ) {
    return this.contacts.removeIdentity(user, ws, id, identityId);
  }
}

@Controller('companies')
@UseGuards(WorkspaceGuard)
export class CompaniesController {
  constructor(@Inject(CompaniesService) private readonly companies: CompaniesService) {}

  @Get()
  list(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listCompaniesSchema)) query: ListCompaniesInput,
  ) {
    return this.companies.list(user, ws, query);
  }

  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createCompanySchema)) body: CreateCompanyInput,
  ) {
    return this.companies.create(user, ws, body);
  }

  @Get(':id')
  get(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.companies.get(user, ws, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateCompanySchema)) body: UpdateCompanyInput,
  ) {
    return this.companies.update(user, ws, id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.companies.setArchived(user, ws, id, true);
  }

  @Post(':id/unarchive')
  @HttpCode(200)
  unarchive(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.companies.setArchived(user, ws, id, false);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.companies.remove(user, ws, id);
  }

  @Put(':id/tags')
  setTags(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(setTagsSchema)) body: SetTagsInput,
  ) {
    return this.companies.setTags(user, ws, id, body);
  }
}

/** Configuração do workspace: tags e campos customizados (escrita só para managers). */
@Controller()
@UseGuards(WorkspaceGuard)
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('tags')
  listTags(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.settings.listTags(user, ws);
  }

  @Post('tags')
  createTag(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createTagSchema)) body: CreateTagInput,
  ) {
    return this.settings.createTag(user, ws, body);
  }

  @Patch('tags/:id')
  updateTag(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateTagSchema)) body: UpdateTagInput,
  ) {
    return this.settings.updateTag(user, ws, id, body);
  }

  @Delete('tags/:id')
  @HttpCode(204)
  deleteTag(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.settings.deleteTag(user, ws, id);
  }

  @Get('custom-fields')
  listFields(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Query(new ZodPipe(listFieldsSchema)) query: ListFieldsInput,
  ) {
    return this.settings.listFields(user, ws, query);
  }

  @Post('custom-fields')
  createField(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Body(new ZodPipe(createFieldSchema)) body: CreateFieldInput,
  ) {
    return this.settings.createField(user, ws, body);
  }

  @Patch('custom-fields/:id')
  updateField(
    @CurrentUser() user: JwtClaims,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateFieldSchema)) body: UpdateFieldInput,
  ) {
    return this.settings.updateField(user, ws, id, body);
  }

  @Delete('custom-fields/:id')
  @HttpCode(204)
  deleteField(@CurrentUser() user: JwtClaims, @CurrentWorkspace() ws: WorkspaceContext, @Param('id', uuidParam) id: string) {
    return this.settings.deleteField(user, ws, id);
  }
}
