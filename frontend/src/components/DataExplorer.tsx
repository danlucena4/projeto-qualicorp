import { useEffect, useState } from 'react';
import {
  api,
  type QcOperator,
  type QcEntity,
  type QcState,
  type QcTable,
  type Stats,
} from '../api/client';

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

  useEffect(() => {
    Promise.all([
      api.getStats(),
      api.listStates(),
      api.listOperators(),
      api.listEntities(),
    ])
      .then(([s, st, o, e]) => {
        setStats(s);
        setStates(st);
        setOperators(o);
        setEntities(e);
      })
      .catch(() => {});
  }, [refreshKey]);

  useEffect(() => {
    api
      .listTables({
        uf: filterUf || undefined,
        operatorId: filterOp ? Number(filterOp) : undefined,
        entityId: filterEnt ? Number(filterEnt) : undefined,
        limit: 50,
      })
      .then((r) => {
        setTables(r.items);
        setTotal(r.total);
      })
      .catch(() => {});
  }, [refreshKey, filterUf, filterOp, filterEnt]);

  return (
    <div>
      <div className="stats">
        <Stat label="Estados sincronizados" value={stats?.states ?? 0} />
        <Stat label="Operadoras" value={stats?.operators ?? 0} />
        <Stat label="Entidades" value={stats?.entities ?? 0} />
        <Stat label="Profissões" value={stats?.professions ?? 0} />
        <Stat label="Tabelas (PDFs)" value={stats?.tables ?? 0} />
      </div>

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

          <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
            Exibindo {tables.length} de {total} tabelas.
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {tables.map((t) => (
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {t.logo_url && (
                    <img
                      src={t.logo_url}
                      alt={t.operator_name}
                      style={{ height: 24, maxWidth: 80, objectFit: 'contain' }}
                    />
                  )}
                  <span
                    style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.05em' }}
                  >
                    {t.uf} · {t.operator_name}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{t.entity_name}</div>
                {t.link_tabela && (
                  <a
                    href={t.link_tabela}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, color: 'var(--accent)', wordBreak: 'break-all' }}
                  >
                    📄 Tabela (PDF)
                  </a>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {(stats?.tables ?? 0) === 0 && (
        <div className="empty" style={{ marginTop: 16 }}>
          Nada extraído ainda. Rode um sync.
        </div>
      )}
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
