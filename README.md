# Astrum CRM

CRM SaaS multi-tenant e omnichannel. Arquitetura e decisões: [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Estrutura

```
apps/
  api/        NestJS — REST /v1, valida JWT do Supabase, roda consultas sob RLS
  web/        Next.js — login, onboarding, troca de workspace
packages/
  db/         schema Drizzle, withUserContext() e testes de isolamento RLS
supabase/
  migrations/ SQL (fonte da verdade do banco)
```

## Pré-requisitos

- Node 24+, pnpm 12 (`npm i -g pnpm@12`)
- Supabase CLI 2.109+
- Docker Desktop (só para rodar o Supabase local; os testes de RLS rodam sem Docker)

## Rodando localmente

```bash
pnpm install
supabase start                      # Postgres, Auth, Studio em http://127.0.0.1:54323
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local   # preencha a publishable key do `supabase status`
pnpm dev                            # web :3000, api :3333
```

## Testes

```bash
pnpm test                           # tudo (RLS no PGlite em memória, sem Docker)
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm db:test
                                    # mesmos testes de RLS no Postgres real do Supabase
```

## Regras de ouro do multi-tenant

1. Toda tabela de negócio tem `tenant_id` + `workspace_id`, FK composta para `workspaces(tenant_id, id)`, RLS ligada e políticas com `private.can_access_workspace(tenant_id, workspace_id)`.
2. A API só consulta dados dentro de `withUserContext()` — a RLS decide o acesso.
3. Toda tabela nova ganha casos em `packages/db/test/isolation.test.ts` antes do merge.
4. Mudança de schema = nova migration via `supabase migration new <nome>`.
