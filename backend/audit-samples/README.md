# Amostras para validação manual

Cada arquivo tem 3 seções:

- **meta** — identificação da tabela (operadora, UF, entidade, URL do PDF)
- **extraction** — JSON raw produzido pelo parser (camada crua, fiel ao PDF)
- **koterPayload** — payload no formato que o Koter consome em `create_table_with_products_cadastro`

| # | Operadora · UF · Entidade | PDF original | Arquivo |
|---|---|---|---|
| 1 | HAPVIDA · AL · ABRABDIR | [PDF](https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_CS_HAPVIDA_AL_NP_25.pdf) | `001_HAPVIDA_AL_ABRABDIR.json` |
| 115 | SULAMÉRICA HOSPITALAR · BA · ABM | [PDF](https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_SAS_BA_F_25_NP.pdf) | `115_SULAM_RICA_HOSPITALAR_BA_ABM.json` |
| 118 | SEGUROS UNIMED · BA · ABM | [PDF](https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_SEG_UNIMED_BA_ABM_26_NP.pdf) | `118_SEGUROS_UNIMED_BA_ABM.json` |
| 135 | ONMED_SAUDE_CLARO · BA · ABM | [PDF](https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_ONMED_BA_F_25.pdf) | `135_ONMED_SAUDE_CLARO_BA_ABM.json` |
| 164 | LIV SAUDE · CE · ABRACEM | [PDF](https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_LIV_SAUDE_FC_CE_25.pdf) | `164_LIV_SAUDE_CE_ABRACEM.json` |
| 597 | HUMANA_SUL · PR · ANAPROLIE | [PDF](https://tabelasdevendas.qualicorp.com.br/tabelas/QUALIPRO_HUM_SAUDE_FC_M_RONDON_PR_SV_26.pdf) | `597_HUMANA_SUL_PR_ANAPROLIE.json` |
