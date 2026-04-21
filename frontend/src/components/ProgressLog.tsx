import { useEffect, useRef } from 'react';

export interface LogLine {
  ts: number;
  kind: 'log' | 'progress' | 'error' | 'warn' | 'mfa' | 'done' | 'status';
  text: string;
}

interface Props {
  lines: LogLine[];
  progressPct?: number;
}

export function ProgressLog({ lines, progressPct }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div>
      {typeof progressPct === 'number' && (
        <div className="progress-bar">
          <div style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }} />
        </div>
      )}
      <div className="log" ref={ref} style={{ marginTop: 10 }}>
        {lines.length === 0 ? (
          <div className="empty">Nenhum evento ainda. Clique em "Iniciar sync" para começar.</div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`line ${l.kind}`}>
              <span style={{ color: 'var(--muted)' }}>
                {new Date(l.ts).toLocaleTimeString()}
              </span>{' '}
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
