import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3333),
  // Conexão direta (5432) ou pooler em modo transação (6543) do Supabase
  DATABASE_URL: z.url(),
  SUPABASE_URL: z.url(),
  // Só para tokens HS256 (segredo legado / CLI local). Projetos com chaves
  // assimétricas validam pelo JWKS e não precisam disto.
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  // F2 · canais: chave que cifra os segredos dos canais (32 bytes em base64).
  // Obrigatória para conectar canais; gere com: openssl rand -base64 32
  CHANNEL_SECRETS_KEY: z.string().optional(),
  // Versão da Graph API da Meta usada pelo WhatsApp (confira a vigente no painel do app)
  WHATSAPP_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v24.0'),
  // Intervalo das novas tentativas da fila de entrada (ms). 0 desliga o timer.
  INBOUND_POLL_MS: z.coerce.number().int().min(0).default(5000),
});

export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
