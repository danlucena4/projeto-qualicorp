# Arquitetura do Projeto Qualicorp

## API real do portal (descoberta via exploração ao vivo)

O portal QualiVendas é um SPA React/Vue. Os dados vêm do **API Gateway**
(plataforma Gravitee) em `https://apigateway.qualicorp.com.br/`. A área "Tabelas
de Venda" cobre a categoria **Adesão** — é lá que a extração acontece.

### Base URL

```
https://apigateway.qualicorp.com.br/tamojunto/tabelas-venda
```

### Autenticação

Toda chamada exige dois headers:

| Header | Valor |
|--------|-------|
| `auth` | `Bearer <token>` — token JWT encriptado pelo front (começa com `U2F` = `Salted__` base64, AES via SecureLS) |
| `X-Gravitee-Api-Key` | UUID do consumer no API Gateway |

> **Importante:** o token fica em `localStorage.auth_corretor_qvenda` após o
> login. Como é encriptado no cliente, **não** reaproveitamos manualmente —
> no scraper usamos Playwright autenticado e interceptamos os headers da
> primeira request real pra reutilizar nas chamadas seguintes (`page.request.get`
> ou `axios` com o header capturado).

### Endpoints

#### `GET /operadoras/{UF}`
Lista operadoras disponíveis no estado.

```json
{
  "status": 200,
  "message": "OK",
  "data": [{ "nome": "HAPVIDA" }, { "nome": "SULAMÉRICA SAÚDE" }, ...]
}
```

#### `GET /profissoes/{UF}?operadoras={csv}`
Profissões aceitas, filtrado pelas operadoras escolhidas.

```json
{ "status": 200, "message": "OK", "data": [{ "nome": "ADVOGADO" }, ...] }
```

#### `GET /entidades/{UF}?operadoras={csv}`
Entidades de classe (associações) aceitas.

```json
{ "status": 200, "message": "OK", "data": [{ "nome": "ABM" }, { "nome": "OAB" }, ...] }
```

#### `GET /{UF}?operadoras={csv}[&profissoes={csv}][&entidades={csv}]`
**Endpoint principal — retorna as tabelas (com link para o PDF).** Um item por
combinação operadora × entidade.

```json
{
  "status": 200,
  "message": "OK",
  "data": [
    {
      "entidade": "ABRABDIR",
      "logoOperadora": "https://tabelasdevendas.qualicorp.com.br/logos/Logo_Hapvida.png",
      "linkTabela":   "https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_CS_HAPVIDA_SALVADOR_BA_NP_25.pdf",
      "linkAdesao":    "",
      "linkFiliacao":  "https://abrabdir.org.br/associese",
      "linkAditivo":   "",
      "linkOutrosDocumentos": "",
      "publico": 3
    },
    ...
  ]
}
```

O campo `logoOperadora` identifica a operadora pelo nome do arquivo do logo
(ex.: `Logo_Hapvida.png` → `HAPVIDA`). `linkTabela` é o PDF da tabela de preços
— ele é exatamente o material que alimenta o agente Koter hoje.

### Volume observado
- Bahia: 10 operadoras, 42 profissões, 38 entidades, **112 tabelas** distintas.
- Estrutura nacional: 27 UFs (lista hardcoded no front).

### Estados
Lista fixa no front — não há endpoint. O scraper itera os 27 UFs; UF sem
cobertura retorna `data: []`.

## Categorias não mapeadas ainda

| Categoria | Onde buscar | Status |
|-----------|-------------|--------|
| Adesão    | `/tamojunto/tabelas-venda/{UF}` (acima) | ✅ mapeado |
| PME       | Fluxo "Criar Proposta PME" / "Simulação PME" | ❌ não mapeado |
| PF        | Sem evidência de PF no QualiVendas | ❌ |

Fase 1 foca só em Adesão. PF/PME entram nas próximas iterações.

## Fluxo do scraper

1. **Playwright** abre Chromium, vai em `https://qualivendas.qualicorp.com.br/#/login`.
2. Se a sessão salva em `.playwright-session/state.json` ainda é válida, pula o
   login. Se não, preenche credenciais do `.env`.
3. MFA (se solicitado): backend emite evento `mfa_required` → frontend abre
   modal → usuário digita código → backend continua.
4. Após login, navega até `/#/tabelas-venda` e dispara uma request qualquer pra
   capturar os headers `auth` + `X-Gravitee-Api-Key` via `page.on('request')`.
5. Com os headers em mãos, o scraper usa `page.request.get(...)` (reutiliza
   cookies + headers) pra chamar as APIs diretamente — sem scraping de DOM.
6. Pra cada UF: busca operadoras → busca tabelas → persiste no SQLite →
   opcionalmente baixa os PDFs.

## Schema do SQLite

Ver `backend/src/db/schema.sql`. Tabelas relevantes pra Adesão:

- `operators` — operadoras extraídas de `logoOperadora`/`nome`.
- `qualicorp_states` — 27 UFs.
- `qualicorp_entities` — entidades de classe (ABM, OAB, etc.).
- `qualicorp_tables` — uma por tupla (UF, operadora, entidade) com `link_tabela`,
  `link_filiacao`, `link_adesao`, `link_aditivo`, `link_outros_documentos`,
  `publico`.
- `plans`, `product_tables`, `products`, `product_cities`, `refnets` — estrutura
  final alinhada ao Koter, preenchida na fase de parsing dos PDFs.
