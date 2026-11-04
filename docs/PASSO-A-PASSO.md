# Passo a passo — o que depende de você

> Atualizado em 2026-11-03. Cada tarefa traz **o que fazer, clique por clique**, **como conferir** e **o que me mandar**.
> Tudo que não está aqui (código, banco, testes, configuração, deploy) fica comigo.
>
> **Regra de ouro:** senhas, tokens e chaves secretas **nunca** vão para o chat. Você os digita direto no terminal ou nos painéis (Supabase, Vercel, Fly, Meta) quando eu pedir.

| Ordem | Tarefa | Quando | Tempo | Trava o quê |
|---|---|---|---|---|
| A | Docker no seu computador | **agora** | ~40 min + reinício | testar o sistema no navegador |
| B | Repositório no GitHub | agora | ~10 min | CI e deploy |
| C | Meta / WhatsApp (verificação da empresa) | **começar já** | 30 min + dias de espera | F2 (WhatsApp de verdade) |
| D | Domínio, e-mail e política de privacidade | junto com C | ~1 h | Meta e e-mails de login |
| E | Contas de produção (Supabase, Vercel, Fly.io) | quando formos publicar | ~1 h | colocar no ar |
| F | Decisões de negócio | quando puder | — | cobrança (F5) |

---

## A. Docker no seu computador

Esta máquina (verificada em 2026-11-03): Windows 11 Home, **WSL não instalado**, 8 GB de RAM, **14 GB livres no C:** e 99 GB no E:. Por isso: instalar o WSL primeiro, limitar a memória e guardar os dados do Docker no **E:**.

### A1. Conferir a virtualização (1 min)
1. Aperte **Ctrl + Shift + Esc** para abrir o Gerenciador de Tarefas.
2. Clique em **Desempenho** (ícone de gráfico, à esquerda) → **CPU**.
3. No canto inferior direito, procure **Virtualização: Habilitado**.
   - **Habilitado** → siga para A2.
   - **Desabilitado** → reinicie, entre na BIOS/UEFI (geralmente apertando **F2**, **Del** ou **F10** logo ao ligar — depende do fabricante), procure *Intel Virtualization Technology (VT-x)* ou *SVM Mode (AMD)*, mude para **Enabled**, salve (normalmente **F10**) e volte a A1.

### A2. Instalar o WSL 2 (5–10 min)
1. Clique no menu **Iniciar**, digite **PowerShell**.
2. No resultado *Windows PowerShell*, clique com o **botão direito → Executar como administrador** → **Sim** na janela de permissão.
3. Na janela azul/preta, digite e aperte Enter:
   ```powershell
   wsl --install --no-distribution
   ```
4. Espere terminar (aparece algo como *"A operação solicitada foi bem-sucedida. As alterações não serão efetivadas até que o sistema seja reinicializado"*).
5. **Reinicie o computador** (Iniciar → Ligar/Desligar → Reiniciar).
6. **Conferir** — depois de reiniciar, abra um PowerShell comum e rode:
   ```powershell
   wsl --status
   ```
   Deve mostrar *Versão padrão: 2*. Se disser que não está instalado, repita os passos 1–5.

> Erro **0x80370102** ou *"a máquina virtual não pôde ser iniciada"* = virtualização desligada → volte a A1.

### A3. Limitar a memória do WSL a 4 GB (3 min)
Com 8 GB de RAM, sem esse limite o Docker pode deixar o Windows lento.
1. Abra o **Bloco de Notas**.
2. Cole exatamente:
   ```ini
   [wsl2]
   memory=4GB
   swap=4GB
   ```
3. **Arquivo → Salvar como…**
   - Pasta: `C:\Users\Usuario`
   - **Tipo:** mude para **Todos os arquivos (\*.\*)** ← importante, senão vira `.wslconfig.txt`
   - **Nome:** `.wslconfig`
   - Codificação: UTF-8 → **Salvar**.
4. **Conferir** no PowerShell:
   ```powershell
   Get-Content $env:USERPROFILE\.wslconfig
   ```
   Deve mostrar as 3 linhas. Se der *"não foi possível encontrar"*, o arquivo ficou com `.txt` no final: renomeie-o no Explorador (Exibir → Mostrar → Extensões de nomes de arquivos).

### A4. Instalar o Docker Desktop (10–15 min)
1. Acesse <https://www.docker.com/products/docker-desktop/> → **Download Docker Desktop** → **Download for Windows – AMD64** (~500 MB).
2. Abra o arquivo baixado (`Docker Desktop Installer.exe`) → **Sim** na permissão.
3. Na tela *Configuration*:
   - ✅ **Use WSL 2 instead of Hyper-V (recommended)** — deixe marcado.
   - "Add shortcut to desktop" — tanto faz.
   → **Ok**.
4. Ao terminar: **Close and restart** (se pedir) ou **Close**.
5. Abra o **Docker Desktop** pelo menu Iniciar.
   - Aceite o contrato (**Accept**).
   - Tela de login: clique em **Skip** / **Continue without signing in** — não é necessário ter conta.
   - Questionário: **Skip**.
6. Espere o ícone da **baleia** na bandeja (perto do relógio) **parar de animar**. No canto inferior esquerdo do Docker Desktop deve aparecer **Engine running** (verde).

### A5. Mover os dados do Docker para o E: (2 min) — faça antes de baixar qualquer imagem
1. No Docker Desktop, clique na **engrenagem ⚙** (Settings), no topo à direita.
2. **Resources** → **Advanced**.
3. Em **Disk image location**, clique em **Browse** → vá até o **E:** → crie uma pasta **Docker** → selecione-a.
4. **Apply & restart** (no canto inferior direito). Espere a baleia parar de novo.

### A6. Conferir (1 min)
Abra um **PowerShell novo** e rode:
```powershell
docker info
```
- ✅ Deu certo se aparecer **Server Version:** seguido de um número.
- ❌ *"error during connect"* ou *"cannot find the file"* → o Docker Desktop não está aberto ou ainda está iniciando. Abra-o, espere *Engine running* e rode de novo.

Teste opcional (baixa uma imagem minúscula):
```powershell
docker run --rm hello-world
```
Deve aparecer *"Hello from Docker!"*.

### A7. Me avisar
Mande no chat: **"docker info funcionou"**. A partir daí eu subo o Supabase local, aplico o banco, crio os arquivos `.env`, rodo os testes no Postgres real e subo a API e o site.

### A8. Criar a primeira conta no sistema (depois que eu avisar que está no ar)
1. Abra <http://localhost:3000>.
2. Preencha **Seu nome**, um **e-mail** (pode ser inventado, ex.: `voce@teste.local` — no ambiente local nenhum e-mail sai de verdade) e uma **senha** com 8+ caracteres → **Criar conta**.
3. Na tela *Crie sua conta*: nome da empresa (ex.: *Astrum Demo*) → **Criar conta**.
4. Você cai em **Negócios**, com o pipeline "Vendas" vazio. Me diga o que funcionou e o que estranhou.
   - E-mails que o sistema "enviaria" aparecem em <http://127.0.0.1:54324>.
   - O banco pode ser visto em <http://127.0.0.1:54323> (Supabase Studio).

---

## B. Repositório no GitHub

### B1. Conta (pule se já tiver)
<https://github.com/signup> → e-mail, senha, nome de usuário → confirme o código enviado ao e-mail.

### B2. Criar o repositório
1. Logado, acesse <https://github.com/new>.
2. **Repository name:** `astrum-crm`.
3. Marque **Private**.
4. **Não** marque nada em *Initialize this repository* (sem README, sem .gitignore, sem licença — o projeto já tem).
5. **Create repository**.
6. Copie a URL que aparece (formato `https://github.com/SEU-USUARIO/astrum-crm.git`) e **me mande**.

### B3. Autorizar o envio (no primeiro push)
Eu rodo o `git push`. Na primeira vez, o Windows abre uma janela do **Git Credential Manager**:
1. Clique em **Sign in with your browser**.
2. No navegador, clique em **Authorize** (Git Credential Manager).
3. Pronto — o Windows guarda a autorização; não precisa repetir.

### B4. Conferir o CI
1. No repositório, aba **Actions**.
2. Deve aparecer o workflow **CI** com dois jobs: *Typecheck, build e testes (PGlite)* e *Isolamento RLS no Postgres real do Supabase*.
3. Ambos com ✅ verde = tudo certo. Se algum ficar ❌ vermelho, me avise (eu leio o log).

---

## C. Meta / WhatsApp — comece já (a verificação leva de dias a semanas)

O Astrum vai conectar o WhatsApp **dos seus clientes**. Para a Meta permitir, a **sua empresa** precisa estar verificada e o app aprovado. As telas da Meta mudam com frequência — se algum nome não bater, procure o equivalente ou consulte <https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>.

**Antes de começar, tenha à mão:**
- Cartão CNPJ (PDF de <https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva/cnpjreva_solicitacao.asp>).
- Comprovante de endereço **no nome da empresa** (conta de luz, água, telefone ou extrato bancário) ou contrato social.
- Site da empresa e um e-mail no domínio dela (ex.: `contato@suaempresa.com.br`) — ver tarefa **D**.
- Um número de telefone que **não** esteja em uso no WhatsApp (para ser o número oficial depois; para testes a Meta fornece um número gratuito).

### C1. Portfólio empresarial (antigo Business Manager)
1. Acesse <https://business.facebook.com> e entre com seu Facebook pessoal (é exigido para administrar).
2. **Criar conta / Criar portfólio**.
3. Preencha: **nome da empresa** (igual à razão social ou ao nome fantasia do CNPJ), **seu nome** e **e-mail comercial** → confirme pelo e-mail recebido.

### C2. Dados da empresa
1. No portfólio: **Configurações** (engrenagem) → **Informações da empresa** (*Business info*).
2. Preencha **exatamente como no cartão CNPJ**: razão social, endereço, telefone, site, CNPJ.
3. **Salvar**.

### C3. Verificação da empresa
1. **Configurações → Central de segurança** (*Security Center*) → **Iniciar verificação**.
2. Escolha **Brasil**, confirme os dados.
3. Envie os documentos: cartão CNPJ + comprovante de endereço no nome da empresa.
4. Escolha como a Meta vai confirmar o contato: **e-mail no domínio** (mais rápido), telefone ou SMS.
5. Aguarde (de alguns dias a algumas semanas). O status aparece na mesma tela.
- **Me mande:** o status ("em análise", "verificada" ou "recusada" + o motivo).

### C4. App de desenvolvedor com WhatsApp (pode fazer enquanto a verificação corre)
1. Acesse <https://developers.facebook.com> → **Começar** (se for a primeira vez: aceite os termos e confirme o celular).
2. **Meus apps → Criar app**.
3. Caso de uso: **Outro** → tipo **Empresa** (*Business*) → nome: `Astrum CRM` → e-mail de contato → selecione o **portfólio** criado em C1 → **Criar app**.
4. No painel do app, em *Adicionar produtos*, encontre **WhatsApp** → **Configurar**.
5. Em **WhatsApp → Configuração da API** (*API Setup*) a Meta mostra um **número de teste gratuito**. Anote (pode me mandar — não são segredos):
   - **ID do app** (*App ID*) — topo da página;
   - **ID da conta do WhatsApp Business** (*WhatsApp Business Account ID*);
   - **ID do número de telefone** (*Phone number ID*).
6. **Não me mande** o *token de acesso* nem a *Chave secreta do app* (*App Secret*). Quando a F2 estiver pronta eu digo exatamente onde colá-los.
7. Ainda nessa tela, em **Para** (*To*), adicione o **seu celular** como destinatário de teste e confirme o código que chega no WhatsApp — assim conseguiremos trocar mensagens de teste com você.

### C5. Configurações básicas do app
**Configurações do app → Básico** (*App settings → Basic*):
- **URL da Política de Privacidade** e **URL dos Termos de Serviço** — os endereços da tarefa D3.
- **Domínios do app:** o seu domínio.
- **Ícone do app** (1024×1024) — pode ser o logotipo.
- **Salvar alterações**.

### C6. Tech Provider e revisão do app (depois — eu aviso)
Para clientes conectarem o próprio WhatsApp pelo botão "Conectar" do Astrum (*Embedded Signup*), o app precisa de **acesso avançado** às permissões `whatsapp_business_management` e `whatsapp_business_messaging` e do cadastro como **Tech Provider**. A revisão pede um **vídeo** mostrando o uso — **eu preparo o roteiro** quando a tela de conexão existir (F2). Não precisa fazer nada agora.

---

## D. Domínio, e-mail e política de privacidade

### D1. Domínio (Registro.br, ~R$ 40/ano)
1. <https://registro.br> → digite o nome desejado (ex.: `astrumcrm.com.br`) → **Pesquisar**.
2. Disponível → **Registrar** → entre ou crie a conta com o **CNPJ** da empresa.
3. Pague (Pix ou boleto). Em poucas horas o domínio fica ativo.
- **Me mande:** o domínio registrado.

### D2. E-mail no domínio
Necessário para a verificação da Meta (C3) e para os e-mails de login do sistema.
- **Opção paga, mais simples:** Google Workspace (<https://workspace.google.com>) ou Microsoft 365 → criar `contato@seudominio`. O assistente deles mostra os registros DNS (MX, TXT) para colar no Registro.br em **Meus domínios → seu domínio → DNS → Editar zona**.
- **Opção gratuita:** Zoho Mail (plano gratuito) — mesmo processo de DNS.
- **Conferir:** mande um e-mail de outra conta para o novo endereço e veja se chega.

### D3. Página de política de privacidade e termos
**Eu escrevo as duas páginas** (em português, pensadas para a LGPD) e as coloco no próprio site do Astrum, em `/privacidade` e `/termos`. Você só **revisa o texto** (idealmente com um advogado) e me diz a **razão social, o CNPJ e o e-mail de contato** que devem aparecer nelas.

---

## E. Contas de produção (quando formos publicar)

### E1. Supabase (banco, login, arquivos)
1. <https://supabase.com/dashboard> → **Sign up** → **Continue with GitHub** (use a conta da tarefa B).
2. **New organization:** nome da empresa, plano **Free** por enquanto → **Create organization**.
3. **New project:**
   - **Name:** `astrum-prod`
   - **Database Password:** clique em **Generate a password** → **copie e guarde num gerenciador de senhas** (Bitwarden, 1Password ou o do navegador). **Não me mande.**
   - **Region:** **South America (São Paulo)**
   → **Create new project** (leva ~2 min).
4. **Project Settings → General** → copie o **Project ID / Reference ID** (algo como `abcdefghijklmnop`) → **me mande**.
5. Quando eu pedir, num terminal na pasta do projeto, rode os comandos que eu indicar (`supabase login` abre o navegador: clique em **Authorize**; `supabase link` pede a senha do banco: **digite no terminal**, não no chat).

### E2. Vercel (site)
1. <https://vercel.com/signup> → **Continue with GitHub**.
   - Plano: o **Hobby** (grátis) é só para uso **não comercial**. Para o Astrum em produção com clientes use o **Pro**. Para testes, o Hobby serve.
2. **Add New… → Project** → em *Import Git Repository*, **Import** ao lado de `astrum-crm` (se não aparecer: *Adjust GitHub App Permissions* → libere o repositório).
3. **Root Directory:** **Edit** → selecione `apps/web` → **Continue**.
4. **Environment Variables** — eu te passo os nomes e valores (só os públicos; nada secreto vai no site).
5. **Deploy**. Me mande a URL gerada (`astrum-crm-xxxx.vercel.app`).

### E3. Fly.io (API)
1. <https://fly.io/app/sign-up> → crie a conta → **Billing → Add credit card** (exigido; o consumo inicial é baixo).
2. Instale o comando `fly` — no PowerShell (comum, não precisa ser administrador):
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
   Feche e abra o PowerShell de novo.
3. Faça login (abre o navegador → **Continue**):
   ```powershell
   fly auth login
   ```
4. **Me avise.** Eu crio o `Dockerfile` e o `fly.toml` da API em São Paulo. Os segredos (`DATABASE_URL` etc.) **você** cadastra com o comando `fly secrets set ...` que eu te passar, colando os valores direto no terminal.

---

## F. Decisões de negócio (responda no chat quando puder)

1. **Planos** — preencha o que imagina (pode ser rascunho):

   | Plano | Preço/mês | Workspaces | Usuários | Canais (WhatsApp etc.) | Mensagens de IA/mês |
   |---|---|---|---|---|---|
   | Básico | | 1 | | | |
   | Pro | | | | | |
   | Agência | | | | | |

2. **Moeda dos negócios:** só R$ por enquanto? (proposta: sim — o campo já existe para outras moedas)
3. **Exclusão de contato (LGPD):** manager exclui direto (como hoje, com confirmação na tela) ou queremos também um **registro de auditoria** de quem excluiu e quando? (proposta: adicionar a auditoria)
4. **Razão social, CNPJ e e-mail de contato** para as páginas de privacidade e termos (D3).

---

## O que eu sigo fazendo sem você
- **F2 — Inbox omnichannel + WhatsApp:** especificação, banco (canais, conversas, mensagens), camada de canais e adaptador da WhatsApp Cloud API, tudo testado com payloads de exemplo da Meta — sem precisar de conta, até a hora de conectar o número de teste (C4).
- Assim que A7 chegar: sistema rodando no navegador.
- Assim que B2 chegar: push e CI.
