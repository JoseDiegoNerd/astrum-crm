import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, HttpStatus } from '@nestjs/common';
import type { JwtClaims } from '@astrum/db';
import { createTestDatabase, seedTenancy, type Tenancy, type TestDatabase } from '@astrum/db/testing';
import { ContactsService } from '../src/crm/contacts.service.js';
import {
  createContactSchema,
  createDealSchema,
  createFieldSchema,
  createPipelineSchema,
  listDealsSchema,
  moveDealSchema,
  updateDealSchema,
} from '../src/crm/crm.schemas.js';
import { DealsService } from '../src/crm/deals.service.js';
import { PipelinesService } from '../src/crm/pipelines.service.js';
import { SettingsService } from '../src/crm/settings.service.js';
import { toHttpException } from '../src/http/database-error.filter.js';
import type { WorkspaceContext } from '../src/http/request.js';

// Funil: serviços reais + Drizzle + RLS.
describe('CRM · funil (serviços sob RLS)', () => {
  let testDb: TestDatabase;
  let t: Tenancy;
  let dealsService: DealsService;
  let pipelinesService: PipelinesService;
  let contactsService: ContactsService;
  let settings: SettingsService;
  let a1: WorkspaceContext;

  const as = (userId: string): JwtClaims => ({ sub: userId, role: 'authenticated' });
  const statusOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return toHttpException(error)?.getStatus() ?? (error as { getStatus?: () => number }).getStatus?.();
    }
    throw new Error('era esperado um erro');
  };
  const board = () => dealsService.board(as(t.carol.id), a1, {});
  const column = async (name: string) => (await board()).columns.find((c) => c.name === name)!;
  const newDeal = (title: string, extra: Record<string, unknown> = {}) =>
    dealsService.create(as(t.carol.id), a1, createDealSchema.parse({ title, ...extra }));

  beforeAll(async () => {
    testDb = await createTestDatabase();
    t = await seedTenancy(testDb);
    const db = testDb.drizzle();
    dealsService = new DealsService(db);
    pipelinesService = new PipelinesService(db);
    contactsService = new ContactsService(db);
    settings = new SettingsService(db);
    a1 = { id: t.a1, tenantId: t.tenantA };
  });

  afterAll(async () => {
    await testDb?.close();
  });

  it('cria no pipeline padrão, na primeira etapa aberta, no topo da coluna', async () => {
    const ana = await contactsService.create(as(t.carol.id), a1, createContactSchema.parse({ name: 'Ana' }));
    const first = await newDeal('Plano anual', { contactId: ana.id, valueCents: 120000 });
    const second = await newDeal('Plano mensal', { valueCents: 9900 });

    expect(first).toMatchObject({ stageName: 'Novo', status: 'open', contactName: 'Ana', valueCents: 120000, currency: 'BRL' });
    const novo = await column('Novo');
    expect(novo.deals.map((d) => d.id)).toEqual([second.id, first.id]);
    expect(novo).toMatchObject({ count: 2, totalCents: 129900 });
  });

  it('move entre etapas e reordena dentro da coluna', async () => {
    const [top, bottom] = (await column('Novo')).deals;

    // bottom vai para o topo
    await dealsService.move(as(t.carol.id), a1, bottom!.id, moveDealSchema.parse({ stageId: (await column('Novo')).id }));
    expect((await column('Novo')).deals.map((d) => d.id)).toEqual([bottom!.id, top!.id]);

    // top vai para "Proposta"; depois bottom entra abaixo dele
    const proposta = await column('Proposta');
    await dealsService.move(as(t.carol.id), a1, top!.id, moveDealSchema.parse({ stageId: proposta.id }));
    await dealsService.move(
      as(t.carol.id),
      a1,
      bottom!.id,
      moveDealSchema.parse({ stageId: proposta.id, afterDealId: top!.id }),
    );
    expect((await column('Proposta')).deals.map((d) => d.id)).toEqual([top!.id, bottom!.id]);
    expect((await column('Novo')).count).toBe(0);
  });

  it('ganho e perdido fecham o negócio; perdido guarda o motivo', async () => {
    const deal = await newDeal('Licença');
    const won = await dealsService.move(as(t.carol.id), a1, deal.id, moveDealSchema.parse({ stageId: (await column('Ganho')).id }));
    expect(won.status).toBe('won');
    expect(won.closedAt).toBeInstanceOf(Date);

    const lost = await dealsService.move(
      as(t.carol.id),
      a1,
      deal.id,
      moveDealSchema.parse({ stageId: (await column('Perdido')).id, lostReason: 'Preço' }),
    );
    expect(lost).toMatchObject({ status: 'lost', lostReason: 'Preço' });

    const listed = await dealsService.list(as(t.carol.id), a1, listDealsSchema.parse({ status: 'lost' }));
    expect(listed.items.map((d) => d.id)).toEqual([deal.id]);
  });

  it('não move para etapa de outro pipeline', async () => {
    const other = await pipelinesService.create(as(t.mia.id), a1, createPipelineSchema.parse({ name: 'Pós-venda' }));
    const deal = await newDeal('Renovação');
    await expect(
      dealsService.move(as(t.carol.id), a1, deal.id, moveDealSchema.parse({ stageId: other.stages[0]!.id })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria em outro pipeline quando informado', async () => {
    const pipelines = await pipelinesService.list(as(t.carol.id), a1);
    const posVenda = pipelines.find((p) => p.name === 'Pós-venda')!;
    const deal = await newDeal('Upsell', { pipelineId: posVenda.id });
    expect(deal.pipelineId).toBe(posVenda.id);
    expect(deal.stageName).toBe('Novo');
  });

  it('só manager configura o funil; etapa com negócios não sai', async () => {
    const [vendas] = await pipelinesService.list(as(t.carol.id), a1);
    expect(await statusOf(pipelinesService.addStage(as(t.carol.id), a1, vendas!.id, { name: 'X', kind: 'open', probability: 0 })))
      .toBe(HttpStatus.FORBIDDEN);

    const withStage = await pipelinesService.addStage(as(t.mia.id), a1, vendas!.id, { name: 'Demonstração', kind: 'open', probability: 40 });
    expect(withStage.stages.map((s) => s.name)).toContain('Demonstração');

    const proposta = vendas!.stages.find((s) => s.name === 'Proposta')!;
    const blocked = await pipelinesService.removeStage(as(t.mia.id), a1, vendas!.id, proposta.id).catch((e) => e);
    expect(toHttpException(blocked)?.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(toHttpException(blocked)?.message).toMatch(/ainda tem negócios/);
  });

  it('reordena etapas e troca o pipeline padrão', async () => {
    const [vendas, posVenda] = await pipelinesService.list(as(t.mia.id), a1);
    const reversed = [...vendas!.stages].reverse().map((s) => s.id);
    const reordered = await pipelinesService.reorderStages(as(t.mia.id), a1, vendas!.id, { stageIds: reversed });
    expect(reordered.stages.map((s) => s.id)).toEqual(reversed);

    await pipelinesService.update(as(t.mia.id), a1, posVenda!.id, { isDefault: true });
    const after = await pipelinesService.list(as(t.mia.id), a1);
    expect(after[0]!.name).toBe('Pós-venda');
    expect(after.filter((p) => p.isDefault)).toHaveLength(1);

    await expect(pipelinesService.remove(as(t.mia.id), a1, posVenda!.id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('campos customizados de negócio e tags', async () => {
    await settings.createField(
      as(t.mia.id),
      a1,
      createFieldSchema.parse({ entity: 'deal', label: 'Origem', type: 'select', options: ['Inbound', 'Outbound'] }),
    );
    const vip = await settings.createTag(as(t.mia.id), a1, { name: 'Estratégico' });
    const deal = await newDeal('Enterprise', { custom: { origem: 'Inbound' } });
    expect(deal.custom).toEqual({ origem: 'Inbound' });

    const tagged = await dealsService.setTags(as(t.carol.id), a1, deal.id, { tagIds: [vip.id] });
    expect(tagged.tags.map((tag) => tag.name)).toEqual(['Estratégico']);

    const updated = await dealsService.update(as(t.carol.id), a1, deal.id, updateDealSchema.parse({ valueCents: 500000, expectedCloseAt: '2026-12-15' }));
    expect(updated).toMatchObject({ valueCents: 500000, expectedCloseAt: '2026-12-15', custom: { origem: 'Inbound' } });
  });

  it('viewer não cria nem move; agent não exclui', async () => {
    const deal = await newDeal('Proteção');
    expect(await statusOf(dealsService.create(as(t.vic.id), a1, createDealSchema.parse({ title: 'X' }))))
      .toBe(HttpStatus.FORBIDDEN);
    await expect(
      dealsService.move(as(t.vic.id), a1, deal.id, moveDealSchema.parse({ stageId: deal.stageId })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(dealsService.remove(as(t.carol.id), a1, deal.id)).rejects.toBeInstanceOf(ForbiddenException);
    await dealsService.remove(as(t.mia.id), a1, deal.id);
  });

  it('outro tenant não enxerga o kanban', async () => {
    const bobBoard = await dealsService.board(as(t.bob.id), a1, {}).catch((e) => e);
    // bob não vê os pipelines de A1: para ele o workspace "não tem pipeline"
    expect(bobBoard).toBeInstanceOf(Error);
  });
});
