import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env';
import { query } from '../db';
import { requireAuth } from './auth';

// Vyre+ — assinatura mensal via Mercado Pago (Preapproval / débito automático)
export const PLUS_PRICE = 19.9;

async function mp(pathname: string, init?: RequestInit) {
  const res = await fetch(`${env.mpApiUrl}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.mpAccessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

export async function billingRoutes(app: FastifyInstance) {
  // Status da assinatura do usuário logado
  app.get('/billing/plus', async (request) => {
    const userId = requireAuth(request);
    const result = await query(
      `SELECT s.id, s.status, s.amount, s.current_period_end, s.mp_preapproval_id,
              u.plus_until
       FROM users u
       LEFT JOIN subscriptions s
         ON s.user_id = u.id AND s.status = 'authorized'
       WHERE u.id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    const plusUntil = row?.plus_until ? new Date(row.plus_until as string) : null;
    return {
      active: !!plusUntil && plusUntil.getTime() > Date.now(),
      until: plusUntil?.toISOString() ?? null,
      price: PLUS_PRICE,
      configured: !!env.mpAccessToken,
    };
  });

  // Cria (ou reativa) a assinatura e devolve o link de checkout do Mercado Pago
  app.post('/billing/plus/checkout', async (request, reply) => {
    const userId = requireAuth(request);
    if (!env.mpAccessToken) {
      return reply.code(503).send({ error: 'Pagamentos ainda não disponíveis' });
    }
    const user = (
      await query(`SELECT id, email, username, display_name FROM users WHERE id = $1`, [userId])
    ).rows[0];
    if (!user) return reply.code(404).send({ error: 'Usuário não encontrado' });

    // Reutiliza um preapproval pendente (evita criar vários na fila de cliques)
    const existing = (
      await query(
        `SELECT mp_preapproval_id FROM subscriptions
         WHERE user_id = $1 AND status = 'pending' AND created_at > now() - interval '30 minutes'
         LIMIT 1`,
        [userId],
      )
    ).rows[0];

    const backUrl = `${env.publicUrl}/app?assinatura=ok`;
    let preapprovalId = existing?.mp_preapproval_id as string | undefined;
    let initPoint: string | undefined;

    if (!preapprovalId) {
      const { res, data } = await mp('/preapproval', {
        method: 'POST',
        body: JSON.stringify({
          reason: 'Vyre+ — Assinatura mensal',
          external_reference: userId,
          back_url: backUrl,
          auto_cancel: true,
          payer_email: user.email,
          transaction_amount: PLUS_PRICE,
          frequency: 1,
          frequency_type: 'months',
          payment_methods: {
            excluded_payment_types: [],
            installments: 1,
          },
        }),
      });
      if (!res.ok) {
        request.log.error({ mp: data }, 'falha ao criar preapproval no Mercado Pago');
        return reply.code(502).send({ error: 'Não foi possível iniciar o pagamento' });
      }
      preapprovalId = data.id as string;
      initPoint = data.init_point as string;
      await query(
        `INSERT INTO subscriptions (user_id, mp_preapproval_id, status, amount)
         VALUES ($1, $2, 'pending', $3)`,
        [userId, preapprovalId, PLUS_PRICE],
      );
    } else {
      // pendente reaproveitada: recupera o link de checkout na API do MP
      const { res, data } = await mp(`/preapproval/${encodeURIComponent(preapprovalId)}`);
      if (res.ok) initPoint = data.init_point as string;
    }

    return reply.send({ preapprovalId, initPoint: initPoint ?? null });
  });

  // Webhook do Mercado Pago — confirma pagamentos e renovações
  // (aberto: a validação é reconsultando a API do MP com o token da conta)
  app.post('/webhooks/mercadopago', async (request, reply) => {
    const body = z
      .object({
        type: z.string().optional(),
        action: z.string().optional(),
        data: z.object({ id: z.string().optional() }).optional(),
      })
      .safeParse(request.body ?? {});
    const id =
      (body.success ? body.data?.data?.id : undefined) ??
      ((request.query as Record<string, string> | undefined)?.['data.id'] as string | undefined) ??
      ((request.query as Record<string, string> | undefined)?.id as string | undefined);
    if (!id) return reply.code(200).send({ ok: true });

    if (!env.mpAccessToken) return reply.code(200).send({ ok: true });

    // Nunca confia no payload do webhook: reconsulta o preapproval na API do MP
    const { res, data } = await mp(`/preapproval/${encodeURIComponent(id)}`);
    if (!res.ok) {
      request.log.warn({ mp: data, id }, 'webhook MP: preapproval não encontrado');
      return reply.code(200).send({ ok: true }); // 200 p/ não reenviar em loop
    }

    const status = data.status as string;
    const userId = data.external_reference as string | undefined;
    const nextPayment = data.next_payment_date ? new Date(data.next_payment_date as string) : null;

    const sub = (
      await query(`SELECT id, user_id FROM subscriptions WHERE mp_preapproval_id = $1`, [id])
    ).rows[0];
    if (!sub || !userId) return reply.code(200).send({ ok: true });

    if (status === 'authorized') {
      // Renovação: estende o período; primeira ativação: +30 dias do agora
      const until =
        nextPayment && nextPayment.getTime() > Date.now()
          ? nextPayment
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await query(
        `UPDATE subscriptions
         SET status = 'authorized', current_period_end = $2, updated_at = now()
         WHERE id = $1`,
        [sub.id, until.toISOString()],
      );
      await query(
        `UPDATE users SET plus_until = GREATEST(COALESCE(plus_until, $2), $2) WHERE id = $1`,
        [userId, until.toISOString()],
      );
      request.log.info({ userId, until }, 'Vyre+ ativado/renovado');
    } else if (status === 'cancelled' || status === 'paused') {
      await query(
        `UPDATE subscriptions SET status = $2, updated_at = now() WHERE id = $1`,
        [sub.id, status === 'paused' ? 'paused' : 'cancelled'],
      );
      // Mantém o benefício até o fim do período já pago (plus_until não é cortado)
    }
    return reply.send({ ok: true });
  });
}
