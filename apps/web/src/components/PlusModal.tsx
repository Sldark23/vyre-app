import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { ApiError, api } from '../api';
import { SparkleIcon, XIcon } from './Icons';

interface PlusStatus {
  active: boolean;
  until: string | null;
  price: number;
  configured: boolean;
}

export default function PlusModal({ onClose }: { onClose: () => void }) {
  const user = useStore((s) => s.user);
  const [status, setStatus] = useState<PlusStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<PlusStatus>('/api/v1/billing/plus')
      .then(setStatus)
      .catch(() => setError('Não foi possível carregar o status da assinatura.'));
  }, []);

  async function checkout() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<{ initPoint: string | null }>(
        '/api/v1/billing/plus/checkout',
      );
      if (res.initPoint) {
        // Pagamento acontece no Mercado Pago; volta em /app?assinatura=ok
        window.location.href = res.initPoint;
      } else {
        setError('Não foi possível iniciar o pagamento. Tente de novo.');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha de conexão');
    } finally {
      setLoading(false);
    }
  }

  const untilDate = status?.until
    ? new Date(status.until).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal plus-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          <XIcon size={18} />
        </button>
        <div className="plus-hero">
          <SparkleIcon size={34} />
          <h2>Vyre+</h2>
          <p className="plus-tagline">
            Apoie o Vyre e ganhe um selo exclusivo no seu perfil e nas mensagens.
          </p>
        </div>

        {status?.active ? (
          <div className="plus-active-box">
            <div className="plus-active-title">
              <SparkleIcon size={16} /> Assinatura ativa
            </div>
            {untilDate && <div className="plus-active-until">Renova em {untilDate}</div>}
          </div>
        ) : (
          <div className="plus-price-box">
            <div className="plus-price">
              R$ {status ? status.price.toFixed(2).replace('.', ',') : '19,90'}
            </div>
            <div className="plus-period">por mês · cancele quando quiser</div>
          </div>
        )}

        <ul className="plus-perks">
          <li>
            <SparkleIcon size={15} /> Selo Vyre+ no perfil, na lista de membros e nas mensagens
          </li>
          <li>
            <SparkleIcon size={15} /> Ajuda direta a manter o Vyre no ar e sem anúncios
          </li>
          <li>
            <SparkleIcon size={15} /> Acesso antecipado a novidades da plataforma
          </li>
        </ul>

        {error && <div className="error-box">{error}</div>}

        {!status?.active && (
          <button className="plus-cta" onClick={checkout} disabled={loading || !status}>
            {loading ? 'Abrindo o Mercado Pago…' : 'Assinar com Mercado Pago'}
          </button>
        )}
        {status && !status.configured && !status.active && (
          <div className="plus-note">
            Pagamentos serão habilitados em breve. {user ? `Obrigado, ${user.displayName}!` : ''}
          </div>
        )}
      </div>
    </div>
  );
}
