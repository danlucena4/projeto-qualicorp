import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  reason?: string;
  onSubmit: (code: string) => Promise<void> | void;
  onCancel: () => void;
}

export function MfaModal({ open, reason, onSubmit, onCancel }: Props) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setSubmitting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open) return null;

  const handle = async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(code.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Código de verificação</h3>
        <p>{reason ?? 'A Qualicorp enviou um código por e-mail. Digite abaixo para continuar.'}</p>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handle()}
          placeholder="000000"
          maxLength={12}
          inputMode="numeric"
          autoComplete="one-time-code"
        />
        <div className="actions">
          <button className="btn ghost" onClick={onCancel} disabled={submitting}>
            Cancelar
          </button>
          <button className="btn" onClick={handle} disabled={!code.trim() || submitting}>
            {submitting ? 'Enviando...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
