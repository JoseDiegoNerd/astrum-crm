# Passo a passo — o que depende de você

> Atualizado em 2026-10-27. Cada etapa diz **o que fazer**, **como conferir** e **o que me mandar** para eu continuar.
> Ordem sugerida: 1 → 2 → 3 hoje; 4 quando for publicar; 5 começar já (é a mais demorada).

---

## 1. Docker Desktop (para rodar o Supabase local) · ~20 min

1. Baixe em <https://www.docker.com/products/docker-desktop/> (Windows, AMD64).
2. Na instalação, deixe marcado **"Use WSL 2"**. Se o Windows pedir para instalar/atualizar o WSL, aceite e reinicie.
3. Abra o Docker Desktop e espere o ícone ficar verde ("Engine running").
4. **Conferir** — no terminal:
   ```bash
   docker info
   ```
   Deve mostrar "Server Version". Se der erro, o Docker Desktop não está aberto.

**Me avise** quando o `docker info` funcionar.

## 2. Rodar o Astrum localmente · ~10 min (posso fazer por você depois do passo 1)

```bash
supabase start
```
Na primeira vez baixa as imagens (alguns minutos). No fim mostra URLs e chaves. Depois:
```bash
supabase status
```
1. Copie `apps/api/.env.example` para `apps/api/.env` (os valores padrão já servem para o local).
2. Copie `apps/web/.env.example` para `apps/web/.env.local` e cole em `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` a chave **Publishable** do `supabase status` (começa com `sb_publishable_`). **Nunca** use a chave Secret no web.
3. Rode `pnpm dev` e abra <http://localhost:3000>.
4. **Conferir:** crie uma conta → crie a empresa → veja o workspace "Principal". O Studio do banco fica em <http://127.0.0.1:54323>.

## 3. Repositório no GitHub · ~5 min

1. Em <https://github.com/new>: nome `astrum-crm`, **Private**, **sem** README/.gitignore/licença (o projeto já tem).
2. Me mande a URL (ex.: `https://github.com/seu-usuario/astrum-crm`). Eu adiciono o remoto e faço o push — ou rode você:
   ```bash
   git remote add origin https://github.com/SEU-USUARIO/astrum-crm.git
   ```
   ```bash
   git push -u origin main
   ```
3. **Conferir:** aba **Actions** do repositório → workflow **CI** com os jobs "Typecheck, build e testes" e "Isolamento RLS no Postgres real do Supabase" verdes.

## 4. Contas de produção · ~40 min (quando formos publicar a F0/F1)

### 4.1 Supabase (banco, login, arquivos)
1. Crie conta em <https://supabase.com/dashboard> e um projeto:
   - Nome `astrum-prod`, região **South America (São Paulo)**.
   - Gere uma senha forte do banco e **guarde num gerenciador de senhas** (não me envie).
2. Em **Authentication → URL Configuration**: Site URL = domínio do web (ex.: `https://app.astrum.com.br`); por enquanto pode ser a URL da Vercel.
3. Em **Authentication → Sign In / Providers → Email**: deixe **Confirm email** ligado.
4. Aplique as migrations (eu conduzo; você só faz o login quando o navegador abrir):
   ```bash
   supabase login
   ```
   ```bash
   supabase link --project-ref SEU_PROJECT_REF
   ```
   ```bash
   supabase db push
   ```
   O `project-ref` está em **Project Settings → General**.
5. **Me mande:** o project ref e a URL do projeto (`https://xxxx.supabase.co`). Chaves secretas e senha do banco você cola direto nos painéis da Vercel/Fly (passos abaixo), não no chat.

### 4.2 Vercel (web)
1. Conta em <https://vercel.com> com login do GitHub → **Add New Project** → importe `astrum-crm`.
2. **Root Directory:** `apps/web`. Framework: Next.js (detectado).
3. Variáveis: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_API_URL` (URL da API no Fly, passo 4.3).
4. Em **Settings → Functions**, região **São Paulo (gru1)**.

### 4.3 Fly.io (API e, na F2, os workers)
1. Conta em <https://fly.io> (pede cartão; há consumo mínimo).
2. Instale o CLI e faça login:
   ```bash
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```
   ```bash
   fly auth login
   ```
3. **Me avise**: eu crio o `Dockerfile`/`fly.toml` da API na região `gru`. Os segredos (`DATABASE_URL` do pooler, `SUPABASE_URL`, `WEB_ORIGIN`) você define com `fly secrets set` — eu passo o comando exato, sem os valores.

### 4.4 Domínio (recomendado)
Registre o domínio (ex.: no Registro.br). Ele é necessário para e-mails de login confiáveis e **obrigatório para a Meta** (política de privacidade e verificação do negócio).

## 5. Meta / WhatsApp Cloud API · comece já (dias a semanas)

O Astrum vai conectar o WhatsApp **dos seus clientes** — para isso a sua empresa precisa estar verificada na Meta e o app precisa ser aprovado. Os nomes de telas mudam com frequência; confira sempre na documentação oficial: <https://developers.facebook.com/docs/whatsapp>.

1. **Portfólio empresarial** em <https://business.facebook.com> com os dados exatamente como no cartão CNPJ.
2. **Verificação da empresa** (Configurações do negócio → Central de segurança → Verificação). Tenha à mão:
   - cartão CNPJ,
   - comprovante de endereço ou conta no nome da empresa,
   - site no seu domínio e um e-mail `@seudominio` (a Meta pode confirmar por ele).
3. **App de desenvolvedor** em <https://developers.facebook.com/apps> → tipo **Business** → vincule ao portfólio → adicione o produto **WhatsApp**. Você ganha um número de teste para começarmos a F2 antes da aprovação.
4. **Publique no seu site:** política de privacidade e termos de uso (URLs públicas) — exigidos na revisão do app.
5. **Tech Provider + revisão do app:** solicite o acesso avançado às permissões `whatsapp_business_management` e `whatsapp_business_messaging` e o cadastro como Tech Provider (necessário para o *Embedded Signup*, o botão "Conectar WhatsApp" dentro do Astrum). A revisão pede um vídeo mostrando o uso — eu preparo o roteiro quando a F2 tiver a tela de conexão.
6. **Me mande** quando tiver: status da verificação, o **App ID** e o **WhatsApp Business Account ID** de teste. O token e o App Secret ficam fora do chat (vão para os segredos do Fly).

## 6. Decisões de produto que travam a F1/F5

Responda quando puder (pode ser direto no chat):

1. **Planos comerciais** — preencha:

   | Plano | Preço/mês | Workspaces | Usuários | Canais | Mensagens de IA/mês |
   |---|---|---|---|---|---|
   | Básico | | 1 | | | |
   | Pro | | | | | |
   | Agência | | | | | |

2. **Moeda dos negócios:** só BRL por enquanto? (proposta: sim)
3. **Exclusão de contato (LGPD):** manager apaga direto ou com confirmação + registro de auditoria? (proposta: confirmação + auditoria)

---

## O que eu faço em seguida (sem depender de você)
- F1.1 — contatos, identidades de canal e empresas (banco → API → telas), usando a skill `astrum-nova-tabela`.
- Assim que o passo 1 estiver ok: teste ponta a ponta no navegador e rodo os testes de RLS também no Postgres real.
- Assim que o passo 3 estiver ok: acompanho o primeiro CI.
