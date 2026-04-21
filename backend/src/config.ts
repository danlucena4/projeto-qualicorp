import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// O .env fica na raiz do monorepo (um nível acima de backend/). Carrega de lá
// com fallback pro cwd (caso o usuário rode de outro local).
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const config = {
  qualicorp: {
    url: process.env.QUALICORP_URL ?? 'https://qualivendas.qualicorp.com.br/#/login',
    user: required('QUALICORP_USER'),
    password: required('QUALICORP_PASSWORD'),
  },
  backend: {
    port: Number(process.env.BACKEND_PORT ?? 3001),
  },
  playwright: {
    headed: (process.env.PLAYWRIGHT_HEADED ?? 'true').toLowerCase() === 'true',
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    storagePath: path.resolve(
      process.cwd(),
      process.env.PLAYWRIGHT_STORAGE ?? './.playwright-session/state.json',
    ),
  },
  paths: {
    dataDir: path.resolve(__dirname, '..', 'data'),
    dbFile: path.resolve(__dirname, '..', 'data', 'qualicorp.db'),
    schemaFile: path.resolve(__dirname, 'db', 'schema.sql'),
  },
};
