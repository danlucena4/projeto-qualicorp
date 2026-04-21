# Projeto Qualicorp

Automação de extração dos planos de saúde da Qualicorp para cadastro no Koter.

## Arquitetura

```
projeto-qualicorp/
├── backend/      Node + Express + Playwright + SQLite (scraper + API)
└── frontend/     React + Vite + TypeScript (UI)
```

O **backend** faz login no portal Qualicorp via Playwright, navega e extrai
os dados estruturados (operadoras, planos, tabelas, produtos, preços, cidades,
redes) que o Koter precisa, persistindo em SQLite local.

O **frontend** é a interface do usuário: dispara sync, recebe progresso ao vivo,
abre modal pra código MFA quando necessário, e permite explorar/validar os
dados extraídos antes da integração com o Koter.

## Setup (primeira vez)

```bash
cd projeto-qualicorp
npm install
npx playwright install chromium --workspace=backend
cp .env.example .env
# Edite .env com as credenciais do Qualicorp
```

## Rodar em dev

```bash
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173

## Stack

- **Backend**: Node 24, TypeScript, Express, Playwright, better-sqlite3
- **Frontend**: React 18, Vite, TypeScript, TailwindCSS

## Status atual

Fase 1 — scaffold + schema do DB + login Qualicorp com suporte a MFA.
Próximas fases: extração dos planos, UI de visualização, integração com Koter.
