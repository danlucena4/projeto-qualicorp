import { useEffect, useState } from 'react';
import {
  api,
  type QcOperator,
  type QcEntity,
  type QcState,
  type QcTable,
  type Stats,
  type ExtractionCounts,
} from '../api/client';
import { ExtractionDrawer } from './ExtractionDrawer';

const PAGE_SIZE_OPTIONS = [24, 48, 96, 200];

export function DataExplorer({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [states, setStates] = useState<QcState[]>([]);
  const [operators, setOperators] = useState<QcOperator[]>([]);
  const [entities, setEntities] = useState<QcEntity[]>([]);
  const [filterUf, setFilterUf] = useState('');
  const [filterOp, setFilterOp] = useState('');
  const [filterEnt, setFilterEnt] = useState('');
  const [tables, setTables] = useState<QcTable[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(48);
  const [selectedTable, setSelectedTable] = useState<QcTable | null>(null);
  const [extractionCounts, setExtractionCounts] = useState<ExtractionCounts | null>(null);
  const [extractingId, setExtractingId] = useState<number | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.getStats(),
      api.listStates(),
      api.listOperators(),
      api.listEntities(),
      api.extractionCounts(),
    ])
      .then(([s, st, o, e, ec]) => {
        setStats(s);
        setStates(st);
        setOperators(o);
        setEntities(e);
        setExtractionCounts(ec);
      })
      .catch(() => {});
  }, [refreshKey]);

  async function refreshExtractionState() {
    try {
      const ec = await api.extractionCounts();
      setExtractionCounts(ec);
    } catch {}
  }

  async function extractOne(id: number) {
    setExtractingId(id);
    try {
      await api.extractPdf(id);
      // refresca a página atual
      const r = await api.listTables({
        uf: filterUf || undefined,
        operatorId: filterOp ? Number(filterOp) : undefined,
        entityId: filterEnt ? Number(filterEnt) : undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setTables(r.items);
      await refreshExtractionState();
    } finally {
      setExtractingId(null);
    }
  }

  async function extractVisible() {
    const ids = tables.filter((t) => !t.pdf_extracted_at && t.link_tabela).map((t) => t.id);
    if (ids.length === 0) return;
    setBulkRunning(true);
    setBulkProgress(`Extraindo ${ids.length} PDFs...`);
    try {
      const r = await api.extractBatch(ids, 4);
      setBulkProgress(`${r.ok} ok, ${r.errors.length} erro(s).`);
      const fresh = await api.listTables({
        uf: filterUf || undefined,
        operatorId: filterOp ? Number(filterOp) : undefined,
        entityId: filterEnt ? Number(filterEnt) : undefined,
        limit: pageSize,
        offset: page * pageSize,
      });
      setTables(fresh.items);
      await refreshExtractionState();
    } catch (err) {
      setBulkProgress(`Erro: ${(err as Error).message}`);
    } finally {
      setBulkRunning(false);
      setTimeout(() => setBulkProgress(null), 5000);
    }
  }

  // Reseta a página quando os filtros ou o pageSize mudam.
  useEffect(() => {
    setPage(0);
  }, [filterUf, filterOp, filterEnt, pageSize, refreshKey]);

  useEffect(() => {
    api
      .listTables({
        uf: filterUf || undefined,
        operatorId: filterOp ? Number(filterOp) : undefined,
        entityId: filterEnt ? Number(filterEnt) : undefined,
        limit: pageSize,
        offset: page * pageSize,
      })
      .then((r) => {
        setTables(r.items);
        setTotal(r.total);
      })
      .catch(() => {});
  }, [refreshKey, filterUf, filterOp, filterEnt, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);

  return (
    <div>
      <div className="stats">
        <Stat label="Estados sincronizados" value={stats?.states ?? 0} />
        <Stat label="Operadoras" value={stats?.operators ?? 0} />
        <Stat label="Entidades" value={stats?.entities ?? 0} />
        <Stat label="Profissões" value={stats?.professions ?? 0} />
        <Stat label="Tabelas (PDFs)" value={stats?.tables ?? 0} />
      </div>

      {extractionCounts && extractionCounts.total > 0 && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: 'var(--panel-light)',
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 13 }}>
            📑 Extração:{' '}
            <strong>{extractionCounts.extracted}</strong> ok{' · '}
            <span style={{ color: 'var(--warn)' }}>{extractionCounts.errors}</span> erro{' · '}
            <span style={{ color: 'var(--muted)' }}>{extractionCounts.pending}</span> pendentes
            {bulkProgress && <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· {bulkProgress}</span>}
          </div>
          <button
            className="btn"
            onClick={extractVisible}
            disabled={bulkRunning || tables.every((t) => !!t.pdf_extracted_at || !t.link_tabela)}
          >
            {bulkRunning ? 'Extraindo...' : 'Extrair PDFs desta página'}
          </button>
        </div>
      )}

      {(stats?.tables ?? 0) > 0 && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 10,
              marginTop: 20,
            }}
          >
            <Select
              label="Estado"
              value={filterUf}
              onChange={setFilterUf}
              options={[{ value: '', label: 'Todos' }, ...states.map((s) => ({ value: s.uf, label: `${s.uf} — ${s.name}` }))]}
            />
            <Select
              label="Operadora"
              value={filterOp}
              onChange={setFilterOp}
              options={[
                { value: '', label: 'Todas' },
                ...operators.map((o) => ({ value: String(o.id), label: `${o.name} (${o.tables_count})` })),
              ]}
            />
            <Select
              label="Entidade"
              value={filterEnt}
              onChange={setFilterEnt}
              options={[
                { value: '', label: 'Todas' },
                ...entities.map((e) => ({ value: String(e.id), label: `${e.name} (${e.tables_count})` })),
              ]}
            />
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rangeStart={start}
            rangeEnd={end}
            total={total}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {tables.map((t) => {
              const status = t.pdf_extraction_error
                ? 'err'
                : t.pdf_extracted_at
                  ? 'ok'
                  : 'pending';
              return (
                <div
                  key={t.id}
                  style={{
                    background: 'var(--panel-light)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {t.logo_url && (
                        <img
                          src={t.logo_url}
                          alt={t.operator_name}
                          style={{ height: 24, maxWidth: 80, objectFit: 'contain' }}
                        />
                      )}
                      <span style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.05em' }}>
                        {t.uf} · {t.operator_name}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 999,
                        background:
                          status === 'ok'
                            ? 'rgba(74, 222, 128, 0.15)'
                            : status === 'err'
                              ? 'rgba(248, 113, 113, 0.15)'
                              : 'rgba(148, 163, 184, 0.15)',
                        color:
                          status === 'ok'
                            ? 'var(--success)'
                            : status === 'err'
                              ? 'var(--danger)'
                              : 'var(--muted)',
                      }}
                    >
                      {status === 'ok' ? 'EXTRAÍDO' : status === 'err' ? 'ERRO' : 'PENDENTE'}
                    </span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{t.entity_name}</div>
                  {t.link_tabela && (
                    <a
                      href={t.link_tabela}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, color: 'var(--accent)' }}
                    >
                      📄 PDF original
                    </a>
                  )}
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {status === 'ok' ? (
                      <button
                        className="btn"
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        onClick={() => setSelectedTable(t)}
                      >
                        Ver extração
                      </button>
                    ) : (
                      <button
                        className="btn"
                        style={{ padding: '6px 10px', fontSize: 12 }}
                        disabled={extractingId === t.id || !t.link_tabela}
                        onClick={() => extractOne(t.id)}
                      >
                        {extractingId === t.id ? 'Extraindo...' : 'Extrair'}
                      </button>
                    )}
                  </div>
                  {t.pdf_extraction_error && (
                    <div style={{ fontSize: 11, color: 'var(--danger)' }}>{t.pdf_extraction_error}</div>
                  )}
                </div>
              );
            })}
          </div>

          {total > pageSize && (
            <Pagination
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              rangeStart={start}
              rangeEnd={end}
              total={total}
              hidePageSize
            />
          )}
        </>
      )}

      {(stats?.tables ?? 0) === 0 && (
        <div className="empty" style={{ marginTop: 16 }}>
          Nada extraído ainda. Rode um sync.
        </div>
      )}

      <ExtractionDrawer table={selectedTable} onClose={() => setSelectedTable(null)} />
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

function Pagination({
  page,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
  rangeStart,
  rangeEnd,
  total,
  hidePageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  hidePageSize?: boolean;
}) {
  // Gera números de páginas com elipses quando há muitas páginas.
  const numbers: Array<number | 'ellipsis'> = (() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    const out: Array<number | 'ellipsis'> = [0];
    const windowStart = Math.max(1, page - 1);
    const windowEnd = Math.min(totalPages - 2, page + 1);
    if (windowStart > 1) out.push('ellipsis');
    for (let i = windowStart; i <= windowEnd; i++) out.push(i);
    if (windowEnd < totalPages - 2) out.push('ellipsis');
    out.push(totalPages - 1);
    return out;
  })();

  const btn = (label: string, targetPage: number, disabled?: boolean, active?: boolean) => (
    <button
      key={`${label}-${targetPage}`}
      onClick={() => onPageChange(targetPage)}
      disabled={disabled}
      style={{
        background: active ? 'var(--accent-strong)' : 'transparent',
        color: active ? '#0b1120' : 'var(--text)',
        border: '1px solid ' + (active ? 'var(--accent-strong)' : 'var(--border)'),
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        minWidth: 36,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        marginTop: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ color: 'var(--muted)', fontSize: 13 }}>
        {total === 0
          ? 'Nenhuma tabela encontrada.'
          : `Exibindo ${rangeStart}–${rangeEnd} de ${total} tabelas · página ${page + 1} de ${totalPages}`}
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {btn('«', 0, page === 0)}
        {btn('‹', Math.max(0, page - 1), page === 0)}
        {numbers.map((n, i) =>
          n === 'ellipsis' ? (
            <span key={`e-${i}`} style={{ color: 'var(--muted)', padding: '0 4px' }}>
              …
            </span>
          ) : (
            btn(String(n + 1), n, false, n === page)
          ),
        )}
        {btn('›', Math.min(totalPages - 1, page + 1), page >= totalPages - 1)}
        {btn('»', totalPages - 1, page >= totalPages - 1)}

        {!hidePageSize && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            style={{
              background: '#0b1120',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              marginLeft: 8,
            }}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}/página
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: '#0b1120',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 13,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
