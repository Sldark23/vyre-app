// E2E Fase 3: voz (LiveKit) — token, permissões e webhook
// Rode: node e2e-fase3.mjs (API em 127.0.0.1:3100)
import fs from 'node:fs';
import jwt from 'jsonwebtoken';
import WebSocket from 'ws';

const API = 'http://127.0.0.1:3100/api/v1';
const PASS = 'senha12345';

let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fails++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(log, pred, ms = 6000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const hit = log.find(pred);
    if (hit) return hit;
    await sleep(150);
  }
  return null;
}

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

function openWs(token, tag, log) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:3100/ws?token=${encodeURIComponent(token)}`);
    ws.on('message', (raw) => {
      const e = JSON.parse(raw.toString());
      log.push(e);
      if (e.type === 'ready') res(ws);
    });
    ws.on('error', (err) => rej(err));
    setTimeout(() => rej(new Error('ws timeout')), 5000);
  });
}

// credenciais LiveKit (mesmas do config em /root/vyre-app/livekit/livekit.yaml)
const envFile = fs.readFileSync('/root/vyre-app/.env', 'utf8');
const LK_KEY = envFile.match(/VYRE_LIVEKIT_KEY=(.+)/)?.[1]?.trim();
const LK_SECRET = envFile.match(/VYRE_LIVEKIT_SECRET=(.+)/)?.[1]?.trim();
ok('credenciais LiveKit no .env', !!LK_KEY && !!LK_SECRET);

function webhookJwt(payload) {
  return jwt.sign(payload, LK_SECRET, { algorithm: 'HS256', keyid: LK_KEY, noTimestamp: false });
}

console.log('— Login —');
const ana = await login('ana.gamer');
const dev = await login('vyre.dev');
ok('login 2 usuários', !!ana.accessToken && !!dev.accessToken);

console.log('— Descobrir canal de voz —');
const clusters = await (await fetch(`${API}/clusters`, { headers: auth(dev.accessToken) })).json();
const clusterId = clusters.clusters[0]?.id;
const detail = await (
  await fetch(`${API}/clusters/${clusterId}`, { headers: auth(dev.accessToken) })
).json();
const voiceCh = detail.channels.find((c) => c.type === 'voice');
const textCh = detail.channels.find((c) => c.type === 'text');
ok('cluster tem canal de voz', !!voiceCh, voiceCh?.name);

console.log('— Token de voz —');
let tokRes = await fetch(`${API}/voice/token`, {
  method: 'POST',
  headers: auth(dev.accessToken),
  body: JSON.stringify({ channelId: voiceCh.id }),
});
let tokBody = await tokRes.json();
ok('token emitido — status 200', tokRes.status === 200, JSON.stringify(tokBody).slice(0, 80));
ok('url do LiveKit correta', tokBody.url === 'wss://voz.vyre.zeninhost.xyz', tokBody.url);
const claims = jwt.decode(tokBody.token) ?? {};
ok('claims: sala = canal', claims.video?.room === voiceCh.id);
ok('claims: identidade = userId', claims.sub === dev.user.id);
ok('claims: permissões de mídia', claims.video?.canPublish === true && claims.video?.canSubscribe === true);
ok('claims: kid da API key', jwt.decode(tokBody.token, { complete: true })?.header?.kid === LK_KEY);

tokRes = await fetch(`${API}/voice/token`, {
  method: 'POST',
  headers: auth(dev.accessToken),
  body: JSON.stringify({ channelId: textCh.id }),
});
ok('canal de texto recusa token — status 400', tokRes.status === 400);

console.log('— Webhook: entrada/saída em voz —');
const devLog = [];
const devWs = await openWs(dev.accessToken, 'dev', devLog);
devWs.send(JSON.stringify({ type: 'subscribe-cluster', cluster: clusterId }));
await sleep(300);

// entrada do dev na sala (identidade = userId, sessão fake)
let whRes = await fetch(`${API}/voice/webhook`, {
  method: 'POST',
  headers: auth('token-inutil'), // auth de usuário é ignorada; manda o JWT de webhook
  body: JSON.stringify({
    event: 'participant_joined',
    room: { name: voiceCh.id },
    participant: { sid: 'sess-e2e-1', identity: dev.user.id },
  }),
});
ok('webhook sem JWT → 401', whRes.status === 401);

const whToken = webhookJwt({
  event: 'participant_joined',
  room: { name: voiceCh.id },
  participant: { sid: 'sess-e2e-1', identity: dev.user.id },
});
whRes = await fetch(`${API}/voice/webhook`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${whToken}` },
  body: '{}',
});
ok('webhook participant_joined aceito', whRes.status === 200);

let list = await (await fetch(`${API}/voice/${voiceCh.id}`, { headers: auth(dev.accessToken) })).json();
ok('dev aparece nos participantes', list.participants.some((p) => p.userId === dev.user.id));
ok('dados do participante (username/displayName)', list.participants.every((p) => p.username && p.displayName));

const voiceEvt = await waitFor(devLog, (e) => e.type === 'voice:update' && e.channelId === voiceCh.id);
ok('WS recebeu voice:update (entrada)', !!voiceEvt && voiceEvt.participants.some((p) => p.userId === dev.user.id));

// saída
const leaveToken = webhookJwt({
  event: 'participant_left',
  room: { name: voiceCh.id },
  participant: { sid: 'sess-e2e-1', identity: dev.user.id },
});
await fetch(`${API}/voice/webhook`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${leaveToken}` },
  body: '{}',
});
list = await (await fetch(`${API}/voice/${voiceCh.id}`, { headers: auth(dev.accessToken) })).json();
ok('dev some dos participantes', list.participants.length === 0);
const leaveEvt = await waitFor(
  devLog,
  (e) => e.type === 'voice:update' && e.channelId === voiceCh.id && e.participants.length === 0,
);
ok('WS recebeu voice:update (saída)', !!leaveEvt);

console.log('— Webhook: room_finished limpa tudo —');
const join2 = webhookJwt({
  event: 'participant_joined',
  room: { name: voiceCh.id },
  participant: { sid: 'sess-e2e-2', identity: ana.user.id },
});
await fetch(`${API}/voice/webhook`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${join2}` },
  body: '{}',
});
const finish = webhookJwt({
  event: 'room_finished',
  room: { name: voiceCh.id },
  participant: {},
});
await fetch(`${API}/voice/webhook`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${finish}` },
  body: '{}',
});
list = await (await fetch(`${API}/voice/${voiceCh.id}`, { headers: auth(dev.accessToken) })).json();
ok('room_finished esvaziou a sala', list.participants.length === 0);

console.log('— Permissão de membro —');
const newCl = await (
  await fetch(`${API}/clusters`, {
    method: 'POST',
    headers: auth(ana.accessToken),
    body: JSON.stringify({ name: 'Cluster Fechado E2E' }),
  })
).json();
const newDetail = await (
  await fetch(`${API}/clusters/${newCl.cluster.id ?? newCl.clusterId ?? newCl.id}`, {
    headers: auth(ana.accessToken),
  })
).json().catch(() => null);
const newVoice = newDetail?.channels?.find((c) => c.type === 'voice');
if (newVoice) {
  tokRes = await fetch(`${API}/voice/token`, {
    method: 'POST',
    headers: auth(dev.accessToken),
    body: JSON.stringify({ channelId: newVoice.id }),
  });
  ok('não-membro não ganha token — status 403', tokRes.status === 403, `status ${tokRes.status}`);
} else {
  ok('cluster novo tem canal de voz padrão', false, JSON.stringify(newCl).slice(0, 120));
}

devWs.close();
console.log('');
if (fails === 0) {
  console.log('🎉 TODOS OS TESTES DA FASE 3 PASSARAM');
} else {
  console.log(`⚠️ ${fails} teste(s) falharam`);
  process.exit(1);
}
