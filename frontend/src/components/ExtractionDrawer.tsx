import { useEffect, useState } from 'react';
import { api, type ExtractedPDF, type QcTable } from '../api/client';

interface Props {
  table: QcTable | null;
  onClose: () => void;
}

const COPART_LABEL: Record<string, string> = {
  WITH: 'Com coparticipação',
  WITHOUT: 'Sem coparticipação',
  PARTIAL: 'Coparticipação parcial',
};

const AGE_LABELS: Array<[keyof ExtractedPDF['tables'][0]['products'][0]['prices'], string]> = [
  ['age0_18', '0-18'],
  ['age19_23', '19-23'],
  ['age24_28', '24-28'],
  ['age29_33', '29-33'],
  ['age34_38', '34-38'],
  ['age39_43', '39-43'],
  ['age44_48', '44-48'],
  ['age49_53', '49-53'],
  ['age54_58', '54-58'],
  ['age59Upper', '59+'],
];

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ExtractionDrawer({ table, onClose }: Props) {
  const [extraction, setExtraction] = useState<ExtractedPDF | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!table) {
      setExtraction(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getExtraction(table.id)
      .then((ext) => setExtraction(ext))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [table?.id]);

  if (!table) return null;

  async function runExtraction() {
    if (!table) return;
    setRunning(true);
    setError(null);
    try {
      const r = await api.extractPdf(table.id);
      if (!r.ok) {
        setError(r.error ?? 'erro desconhecido');
      } else {
        const ext = await api.getExtraction(table.id);
        setExtraction(ext);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(720px, 92vw)',
        background: 'var(--panel)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-2px 0 24px rgba(0,0,0,0.4)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 120,
      }}
    >
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.05em' }}>
            {table.uf} · {table.operator_name}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{table.entity_name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {table.link_tabela && (
            <a
              href={table.link_tabela}
              target="_blank"
              rel="noreferrer"
              className="btn ghost"
              style={{ textDecoration: 'none' }}
            >
              PDF
            </a>
          )}
          <button className="btn ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {loading && <div className="empty">Carregando...</div>}
        {error && (
          <div
            style={{
              background: 'rgba(248, 113, 113, 0.12)',
              color: 'var(--danger)',
              padding: 12,
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            ✗ {error}
          </div>
        )}
        {!extraction && !loading && (
          <div style={{ textAlign: 'center', padding: 30 }}>
            <p style={{ color: 'var(--muted)' }}>Ainda não foi extraído esse PDF.</p>
            <button className="btn" onClick={runExtraction} disabled={running}>
              {running ? 'Extraindo...' : 'Extrair agora'}
            </button>
          </div>
        )}
        {extraction && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn ghost" onClick={runExtraction} disabled={running}>
                {running ? 'Re-extraindo...' : '↻ Re-extrair'}
              </button>
            </div>
            <ExtractionSummary extraction={extraction} />
          </>
        )}
      </div>
    </div>
  );
}

function ExtractionSummary({ extraction: e }: { extraction: ExtractedPDF }) {
  return (
    <>
      <Section title="Resumo">
        <div className="stats" style={{ margin: 0 }}>
          <Stat label="Páginas" value={e.stats.pages} />
          <Stat label="Tabelas" value={e.stats.tableBlocks} />
          <Stat label="Produtos" value={e.stats.products} />
          <Stat label="Cidades" value={e.stats.citiesCount} />
          <Stat label="Redes" value={e.stats.refnetsCount} />
        </div>
        {e.validityBaseMonth && (
          <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 8 }}>
            Validade: {e.validityPeriod ?? ''} (base {e.validityBaseMonth})
          </div>
        )}
        {e.stats.warnings.length > 0 && (
          <ul style={{ marginTop: 10, color: 'var(--warn)', fontSize: 12, paddingLeft: 18 }}>
            {e.stats.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Tabelas (${e.tables.length})`}>
        {e.tables.map((t, i) => (
          <div
            key={i}
            style={{
              marginBottom: 14,
              background: 'var(--panel-light)',
              borderRadius: 6,
              padding: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.blockLabel}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                  {t.includesCoparticipation ? COPART_LABEL[t.includesCoparticipation] : 'Copart: ?'}
                  {' · '}
                  {t.products.length} produtos
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                    <th style={{ padding: 4 }}>ANS</th>
                    <th style={{ padding: 4 }}>Abrangência</th>
                    <th style={{ padding: 4 }}>Segmentação</th>
                    <th style={{ padding: 4 }}>Acom.</th>
                    {AGE_LABELS.map(([, l]) => (
                      <th key={l} style={{ padding: 4, textAlign: 'right' }}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.products.map((p, j) => (
                    <tr key={j} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6 }}>{p.ansCode ?? '?'}</td>
                      <td style={{ padding: 6 }}>{p.coverage ?? '?'}</td>
                      <td style={{ padding: 6 }}>{p.segment ?? '?'}</td>
                      <td style={{ padding: 6 }}>{p.accommodation ?? '—'}</td>
                      {AGE_LABELS.map(([k]) => (
                        <td key={k} style={{ padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {fmt(p.prices[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Section>

      <Section title={`Entidades aceitas (${e.entities.length})`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {e.entities.map((x, i) => (
            <span
              key={i}
              title={x.name}
              style={{
                background: 'var(--panel-light)',
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 12,
              }}
            >
              {x.code}
            </span>
          ))}
        </div>
      </Section>

      <Section title={`Cidades cobertas (${e.cities.length})`}>
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>
          {e.cities.map((c) => c.name).join(', ')}
        </div>
      </Section>

      {e.refnets.length > 0 && (
        <Section title={`Rede referenciada (${e.refnets.length})`}>
          <div style={{ fontSize: 12 }}>
            {e.refnets.map((r, i) => (
              <div
                key={i}
                style={{
                  padding: '6px 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
              >
                <span>
                  {r.kind === 'HOSPITAL' ? '🏥' : r.kind === 'LAB' ? '🧪' : '•'} {r.name}{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    {r.city ? `(${r.city})` : ''}
                  </span>
                </span>
                {r.specialties && (
                  <span style={{ color: 'var(--muted)' }}>{r.specialties.join('/')}</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 12, letterSpacing: '0.06em', color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
