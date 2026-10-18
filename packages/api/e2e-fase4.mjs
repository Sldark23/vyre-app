// E2E Fase 4: gestão, moderação e mídia
// Rode: node e2e-fase4.mjs (API em 127.0.0.1:3100)
import WebSocket from 'ws';

const API = 'http://127.0.0.1:3100/api/v1';
const WEB = 'http://127.0.0.1:3100';
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

function openWs(token, log) {
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

async function j(method, path, token, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: auth(token),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await r.json();
  } catch {
    /* vazio */
  }
  return { status: r.status, data };
}

console.log('— Login —');
const ana = await login('ana.gamer');
const dev = await login('vyre.dev');
ok('login 2 usuários', !!ana.accessToken && !!dev.accessToken);

const devLog = [];
const devWs = await openWs(dev.accessToken, devLog);
ok('WS do dev conectado', devLog.some((e) => e.type === 'ready'));

console.log('— Criar cluster de teste (ana = dona) —');
const created = await j('POST', '/clusters', ana.accessToken, {
  name: 'Fase4 QA',
  description: 'suíte de gestão',
});
ok('cluster criado — 201', created.status === 201, JSON.stringify(created.data).slice(0, 90));
const cid = created.data.cluster?.id;
const invite = created.data.cluster?.inviteCode;
const channels0 = created.data.channels ?? [];
const geral = channels0.find((c) => c.name === 'geral');
const anuncios = channels0.find((c) => c.type === 'announcement');
const voz = channels0.find((c) => c.type === 'voice');
ok('canais default (geral/anúncios/voz)', !!geral && !!anuncios && !!voz);
ok('dono tem papel owner (no retorno)', (await j('GET', `/clusters/${cid}`, ana.accessToken)).data.myRole === 'owner');

console.log('— Não-membro não vê o cluster —');
const nm = await j('GET', `/clusters/${cid}`, dev.accessToken);
ok('dev (fora) recebe 403', nm.status === 403);

console.log('— Dev entra por convite —');
const join = await j('POST', '/clusters/join', dev.accessToken, { code: invite });
ok('join ok', join.status === 200 || join.status === 201, `status ${join.status}`);
const detDev = await j('GET', `/clusters/${cid}`, dev.accessToken);
ok('dev vê o cluster', detDev.status === 200);
ok('dev myRole = member', detDev.data.myRole === 'member', detDev.data.myRole);
ok('ana marcada como owner na lista', detDev.data.members.some((m) => m.role === 'owner' && m.user.username === 'ana.gamer'));

console.log('— Criação de canal —');
const chNew = await j('POST', `/clusters/${cid}/channels`, ana.accessToken, {
  name: 'testando',
  type: 'text',
});
ok('dona cria canal — 201', chNew.status === 201, JSON.stringify(chNew.data).slice(0, 80));
const chId = chNew.data.channel?.id;
const chDev = await j('POST', `/clusters/${cid}/channels`, dev.accessToken, {
  name: 'nao-pode',
  type: 'text',
});
ok('membro comum NÃO cria canal — 403', chDev.status === 403);

console.log('— Renomear / mover canal —');
const rename = await j('PATCH', `/channels/${chId}`, ana.accessToken, { name: 'renomeado' });
ok('dona renomeia — 200', rename.status === 200 && rename.data.channel?.name === 'renomeado');
const renameDev = await j('PATCH', `/channels/${chId}`, dev.accessToken, { name: 'hack' });
ok('membro NÃO renomeia — 403', renameDev.status === 403);
const before = (await j('GET', `/clusters/${cid}`, ana.accessToken)).data.channels.map((c) => c.name);
const move = await j('PATCH', `/channels/${chId}`, ana.accessToken, { move: 'up' });
const after = move.data.channels?.map((c) => c.name) ?? [];
ok(
  'mover pra cima troca a ordem',
  move.status === 200 && after.length === before.length && after.join() !== before.join(),
  `${before} → ${after}`,
);

console.log('— Regras de anúncio e voz —');
const annDev = await j('POST', `/channels/${anuncios.id}/messages`, dev.accessToken, {
  content: 'tentativa de anúncio',
});
ok('membro NÃO posta em anúncios — 403', annDev.status === 403, annDev.data.error);
const annAna = await j('POST', `/channels/${anuncios.id}/messages`, ana.accessToken, {
  content: 'anúncio oficial da dona',
});
ok('dona posta em anúncios — 201', annAna.status === 201);
const voiceMsg = await j('POST', `/channels/${voz.id}/messages`, ana.accessToken, {
  content: 'msg em canal de voz',
});
ok('canal de voz recusa mensagem — 403', voiceMsg.status === 403, voiceMsg.data.error);

console.log('— Upload de imagem —');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const fd = new FormData();
fd.append('file', new Blob([png], { type: 'image/png' }), 't.png');
const up = await fetch(`${API}/uploads`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${ana.accessToken}` },
  body: fd,
});
const upBody = await up.json();
ok('upload PNG — 201', up.status === 201 && !!upBody.url, String(upBody.url ?? upBody.error));
ok('URL pública no formato certo', /https:\/\/.+\/uploads\/.+\.png/.test(upBody.url ?? ''));
const fileGet = await fetch(`${WEB}${(upBody.url ?? '').replace(/^https?:\/\/[^/]+/, '')}`);
ok('arquivo servido — 200', fileGet.status === 200);

const fdTxt = new FormData();
fdTxt.append('file', new Blob(['nao e imagem'], { type: 'text/plain' }), 't.txt');
const upTxt = await fetch(`${API}/uploads`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${ana.accessToken}` },
  body: fdTxt,
});
ok('upload de texto — 415', upTxt.status === 415);

const fdNoAuth = new FormData();
fdNoAuth.append('file', new Blob([png], { type: 'image/png' }), 't.png');
const upNo = await fetch(`${API}/uploads`, { method: 'POST', body: fdNoAuth });
ok('upload sem token — 401', upNo.status === 401);

console.log('— Mensagem com anexo —');
const withAtt = await j('POST', `/channels/${geral.id}/messages`, ana.accessToken, {
  content: 'olha a imagem',
  attachments: [{ url: upBody.url, name: 't.png' }],
});
ok('mensagem com anexo — 201', withAtt.status === 201, JSON.stringify(withAtt.data).slice(0, 90));
ok('anexo no payload', withAtt.data.message?.attachments?.length === 1);
const list = await j('GET', `/channels/${geral.id}/messages?limit=20`, dev.accessToken);
const fromList = list.data.messages?.find((m) => m.id === withAtt.data.message?.id);
ok('anexo sobrevive ao GET', fromList?.attachments?.[0]?.name === 't.png');

const evil = await j('POST', `/channels/${geral.id}/messages`, dev.accessToken, {
  attachments: [{ url: 'https://evil.example.com/x.png', name: 'x.png' }],
});
ok('URL de anexo alheia — 400', evil.status === 400);
const empty = await j('POST', `/channels/${geral.id}/messages`, dev.accessToken, {});
ok('mensagem vazia — 400', empty.status === 400);

console.log('— Promoção a moderador —');
const promo = await j('PUT', `/clusters/${cid}/members/${dev.user.id}/role`, ana.accessToken, {
  role: 'moderator',
});
ok('promoção — 200', promo.status === 200 && promo.data.role === 'moderator');
const detMod = await j('GET', `/clusters/${cid}`, dev.accessToken);
ok('dev vê myRole = moderator', detMod.data.myRole === 'moderator', detMod.data.myRole);

console.log('— Poderes de mod —');
const modCh = await j('POST', `/clusters/${cid}/channels`, dev.accessToken, {
  name: 'canal-do-mod',
  type: 'forum',
});
ok('mod cria canal — 201', modCh.status === 201);
const modAnn = await j('POST', `/channels/${anuncios.id}/messages`, dev.accessToken, {
  content: 'aviso do mod',
});
ok('mod posta em anúncios — 201', modAnn.status === 201);
const modDel = await j('DELETE', `/messages/${annAna.data.message?.id}`, dev.accessToken);
ok('mod apaga mensagem da dona — 200', modDel.status === 200);
const memberDel = await j('DELETE', `/messages/${annAna.data.message?.id}`, dev.accessToken);
ok('apagar mensagem inexistente — 404', memberDel.status === 404);
const modPatchCluster = await j('PATCH', `/clusters/${cid}`, dev.accessToken, { name: 'hackeado' });
ok('mod NÃO edita dados do cluster — 403', modPatchCluster.status === 403);
const modBanOwner = await j('DELETE', `/clusters/${cid}/members/${ana.user.id}`, dev.accessToken);
ok('mod NÃO kicka o dono — 403', modBanOwner.status === 403);

console.log('— Rebaixamento —');
const demo = await j('PUT', `/clusters/${cid}/members/${dev.user.id}/role`, ana.accessToken, {
  role: 'member',
});
ok('rebaixado — 200', demo.status === 200 && demo.data.role === 'member');
const afterDemo = await j('POST', `/clusters/${cid}/channels`, dev.accessToken, {
  name: 'nao-pode-2',
  type: 'text',
});
ok('ex-mod NÃO cria canal — 403', afterDemo.status === 403);

console.log('— Kick + notificação por WS —');
const kick = await j('DELETE', `/clusters/${cid}/members/${dev.user.id}`, ana.accessToken);
ok('kick — 200', kick.status === 200);
const removedEv = await waitFor(devLog, (e) => e.type === 'cluster:removed' && e.clusterId === cid);
ok('dev recebeu cluster:removed no WS', !!removedEv);
const kicked = await j('GET', `/clusters/${cid}`, dev.accessToken);
ok('dev kickado perde acesso — 403', kicked.status === 403);
const rejoin = await j('POST', '/clusters/join', dev.accessToken, { code: invite });
ok('dev reconvida entra de volta — 200/201', rejoin.status === 200 || rejoin.status === 201);
const back = await j('GET', `/clusters/${cid}`, dev.accessToken);
ok('de volta como member', back.status === 200 && back.data.myRole === 'member');

console.log('— DM com anexo —');
const conv = await j('POST', '/dms', dev.accessToken, { userIds: [ana.user.id] });
const convId = conv.data.conversation?.id;
ok('DM 1:1 aberta', !!convId, String(convId ?? JSON.stringify(conv.data).slice(0, 80)));
const dmAtt = await j('POST', `/dms/${convId}/messages`, dev.accessToken, {
  content: 'foto na dm',
  attachments: [{ url: upBody.url, name: 't.png' }],
});
ok('DM com anexo — 201', dmAtt.status === 201, JSON.stringify(dmAtt.data).slice(0, 80));
ok('anexo presente na DM', dmAtt.data.message?.attachments?.length === 1);

console.log('— Guarda do último canal + apagar cluster —');
const allCh = (await j('GET', `/clusters/${cid}`, ana.accessToken)).data.channels;
for (const c of allCh.slice(1)) {
  await j('DELETE', `/channels/${c.id}`, ana.accessToken);
}
const last = await j('GET', `/clusters/${cid}`, ana.accessToken);
ok('sobrou 1 canal', last.data.channels.length === 1, `total ${last.data.channels.length}`);
const delLast = await j('DELETE', `/channels/${last.data.channels[0].id}`, ana.accessToken);
ok('último canal NÃO apaga — 400', delLast.status === 400, delLast.data.error);
const delCluster = await j('DELETE', `/clusters/${cid}`, ana.accessToken);
ok('cluster apagado — 200', delCluster.status === 200);
const removedEv2 = await waitFor(devLog, (e) => e.type === 'cluster:removed' && e.clusterId === cid);
ok('dev recebeu 2º cluster:removed (cluster apagado)', !!removedEv2);
const gone = await j('GET', `/clusters/${cid}`, ana.accessToken);
ok('cluster some (sem acesso) — 403/404', gone.status === 403 || gone.status === 404, `status ${gone.status}`);

devWs.close();
console.log(fails === 0 ? '\n🎉 Fase 4: todos os testes passaram' : `\n💥 Fase 4: ${fails} falha(s)`);
process.exit(fails === 0 ? 0 : 1);
