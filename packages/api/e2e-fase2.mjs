// E2E Fase 2: amigos, DMs, perfil e presença — 2 usuários reais
import WebSocket from 'ws';

const API = 'http://127.0.0.1:3100/api/v1';
const PASS = 'senha12345';

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

async function login(identifier) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASS }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`login ${identifier}: ${JSON.stringify(d)}`);
  return d;
}

const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openWs(token, tag, log) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:3100/ws?token=${encodeURIComponent(token)}`);
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      log.push(e);
      console.log(`   [ws ${tag}] ${e.type}${e.status ? ':' + e.status : ''}${e.from ? ' de @' + e.from.username : ''}`);
      if (e.type === 'ready') res(ws);
    });
    ws.on('error', (err) => rej(err));
    setTimeout(() => rej(new Error('ws timeout')), 5000);
  });
}

const anaLog = [];
const devLog = [];

console.log('— Login —');
const ana = await login('ana.gamer');
const dev = await login('vyre.dev');
ok('login 2 usuários', !!ana.accessToken && !!dev.accessToken);

console.log('— Reset de estado —');
// zera a DM 1:1 entre os usuários de teste (o dm:created só dispara em criação real)
{
  const fs = await import('node:fs');
  const { default: pg } = await import('pg');
  const dbEnv = fs.readFileSync('/root/vyre-app/.env.db', 'utf8');
  const pw = dbEnv.match(/VYRE_DB_PASSWORD=(.+)/)?.[1]?.trim() ?? '';
  const client = new pg.Client({
    connectionString: process.env.VYRE_DB_URL ?? `postgres://vyre:${pw}@127.0.0.1:5433/vyre`,
  });
  await client.connect();
  await client.query(
    `DELETE FROM dm_conversations WHERE is_group = false AND id IN (
       SELECT a.conversation_id FROM dm_participants a
       JOIN dm_participants b ON b.conversation_id = a.conversation_id AND b.user_id = $2
       WHERE a.user_id = $1
     )`,
    [ana.user.id, dev.user.id],
  );
  await client.end();
  console.log('   (DM antiga zerada)');
}
await fetch(`${API}/friends/${ana.user.id}`, { method: 'DELETE', headers: auth(dev.accessToken) });
for (const token of [ana.accessToken, dev.accessToken]) {
  const f = await (await fetch(`${API}/friends`, { headers: auth(token) })).json();
  for (const r of [...f.incoming, ...f.outgoing]) {
    await fetch(`${API}/friends/requests/${r.id}/decline`, { method: 'POST', headers: auth(token) });
  }
}
console.log('   (amizades e pedidos limpos)');

console.log('— WebSocket —');
const anaWs = await openWs(ana.accessToken, 'ana', anaLog);
const devWs = await openWs(dev.accessToken, 'dev', devLog);
ok('ambos conectados no WS', anaLog.some((e) => e.type === 'ready') && devLog.some((e) => e.type === 'ready'));

// ana escuta o tópico do cluster (presença dos membros)
const myClusters = await (await fetch(`${API}/clusters`, { headers: auth(ana.accessToken) })).json();
anaWs.send(JSON.stringify({ type: 'subscribe-cluster', cluster: myClusters.clusters[0]?.id }));
await sleep(300);

console.log('— Pedido de amizade (dev → ana) —');
let reqRes = await fetch(`${API}/friends/requests`, {
  method: 'POST',
  headers: auth(dev.accessToken),
  body: JSON.stringify({ username: 'ana.gamer' }),
});
let reqBody = await reqRes.json();
if (reqRes.status === 409) console.log('   (pedido já existia de execução anterior)');
ok('envio de pedido', reqRes.ok || reqRes.status === 409, `status ${reqRes.status}`);
await sleep(600);
ok('ana recebeu friend:request via WS', anaLog.some((e) => e.type === 'friend:request'));

const inc = await (await fetch(`${API}/friends`, { headers: auth(ana.accessToken) })).json();
ok('ana vê pedido pendente', inc.incoming.some((r) => r.user.username === 'vyre.dev'));
const reqId = inc.incoming.find((r) => r.user.username === 'vyre.dev')?.id;

console.log('— Aceitar —');
const acc = await fetch(`${API}/friends/requests/${reqId}/accept`, {
  method: 'POST',
  headers: auth(ana.accessToken),
});
ok('accept', acc.ok);
await sleep(600);
ok('dev recebeu friend:accepted via WS', devLog.some((e) => e.type === 'friend:accepted'));

const devFriends = await (await fetch(`${API}/friends`, { headers: auth(dev.accessToken) })).json();
ok('dev vê ana como amiga', devFriends.friends.some((f) => f.user.username === 'ana.gamer'));

console.log('— DM —');
const dmRes = await fetch(`${API}/dms`, {
  method: 'POST',
  headers: auth(ana.accessToken),
  body: JSON.stringify({ userIds: [dev.user.id] }),
});
const dmBody = await dmRes.json();
ok('criar/abrir DM', dmRes.ok, `status ${dmRes.status}`);
const convId = dmBody.conversation?.id;
await sleep(600);
ok('dev recebeu dm:created via WS', devLog.some((e) => e.type === 'dm:created'));

devWs.send(JSON.stringify({ type: 'subscribe-dm', conversation: convId }));
await sleep(300);

const msgRes = await fetch(`${API}/dms/${convId}/messages`, {
  method: 'POST',
  headers: auth(ana.accessToken),
  body: JSON.stringify({ content: 'Oi! Teste da Fase 2 🚀' }),
});
ok('enviar msg na DM', msgRes.ok);
await sleep(600);
ok('dev recebeu dm:message:created via WS', devLog.some((e) => e.type === 'dm:message:created'));

const dmMsgs = await (await fetch(`${API}/dms/${convId}/messages`, { headers: auth(dev.accessToken) })).json();
ok('dev lista mensagens da DM', dmMsgs.messages?.length >= 1, `${dmMsgs.messages?.length} msgs`);

const dmList = await (await fetch(`${API}/dms`, { headers: auth(dev.accessToken) })).json();
ok('dev vê a conversa na lista', dmList.conversations?.some((c) => c.id === convId));

console.log('— Perfil —');
const prof = await (await fetch(`${API}/users/vyre.dev`, { headers: auth(ana.accessToken) })).json();
ok('perfil público', prof.profile?.user?.username === 'vyre.dev');
ok('relationship = friends', prof.profile?.relationship === 'friends', prof.profile?.relationship);
ok('clusters em comum', (prof.profile?.sharedClusters ?? 0) >= 1, `n=${prof.profile?.sharedClusters}`);

const patch = await fetch(`${API}/users/me`, {
  method: 'PATCH',
  headers: auth(ana.accessToken),
  body: JSON.stringify({ bio: 'Perfil atualizado na Fase 2', customStatus: 'testando Vyre' }),
});
const patchBody = await patch.json();
ok('editar perfil', patch.ok && patchBody.user?.customStatus === 'testando Vyre');

console.log('— Presença —');
devWs.send(JSON.stringify({ type: 'presence', status: 'idle' }));
await sleep(700);
const gotPresence = anaLog.filter((e) => e.type === 'presence:update' && e.userId === dev.user.id).pop();
ok('ana recebeu presence:idle do dev via WS', gotPresence?.status === 'idle', gotPresence?.status);

devWs.send(JSON.stringify({ type: 'presence', status: 'online' }));
await sleep(500);

console.log('— Remover amizade —');
const unf = await fetch(`${API}/friends/${ana.user.id}`, { method: 'DELETE', headers: auth(dev.accessToken) });
ok('unfriend', unf.ok);
await sleep(500);
ok('ana recebeu friend:removed via WS', anaLog.some((e) => e.type === 'friend:removed'));

// reverte: volta a serem amigos pra facilitar os testes manuais da UI
const again = await fetch(`${API}/friends/requests`, {
  method: 'POST',
  headers: auth(dev.accessToken),
  body: JSON.stringify({ username: 'ana.gamer' }),
});
const againBody = await again.json();
if (!againBody.accepted) {
  const inc2 = await (await fetch(`${API}/friends`, { headers: auth(ana.accessToken) })).json();
  const id2 = inc2.incoming.find((r) => r.user.username === 'vyre.dev')?.id;
  if (id2) await fetch(`${API}/friends/requests/${id2}/accept`, { method: 'POST', headers: auth(ana.accessToken) });
}
const finalFriends = await (await fetch(`${API}/friends`, { headers: auth(dev.accessToken) })).json();
ok('revertido: são amigos de novo', finalFriends.friends.some((f) => f.user.username === 'ana.gamer'));

anaWs.close();
devWs.close();
console.log(fails === 0 ? '\n🎉 TODOS OS TESTES DA FASE 2 PASSARAM' : `\n⚠️ ${fails} teste(s) falharam`);
process.exit(fails === 0 ? 0 : 1);
