# Vyre API — Referência (v1)

Base (API dedicada): `https://app.vyre.zeninhost.xyz` (local: `http://127.0.0.1:3100`)
Web app: `https://vyre.zeninhost.xyz` (mesma API, same-origin). O domínio `app.vyre` expõe **só** `/api/*`, `/ws` e `/uploads/*` — pensado no app mobile.
WebSocket: `wss://app.vyre.zeninhost.xyz/ws?token=<accessToken>`.
Todas as rotas ficam em `/api/v1`. Autenticação via `Authorization: Bearer <accessToken>` (JWT, 15 min) com refresh em `/auth/refresh`.

## Autenticação

| Método | Rota | Descrição |
|---|---|---|
| POST | `/auth/register` | `{username, email, password, displayName?}` → usuário + tokens |
| POST | `/auth/login` | `{identifier (email ou username), password}` → usuário + tokens |
| POST | `/auth/refresh` | `{refreshToken}` → novo par de tokens (rotação) |
| POST | `/auth/logout` | `{refreshToken}` → revoga o refresh token |
| GET | `/auth/me` | usuário atual |

## Clusters

| Método | Rota | Descrição |
|---|---|---|
| GET | `/clusters` | clusters do usuário (com `firstChannelId`) |
| POST | `/clusters` | `{name, description?}` → cria cluster + canais padrão |
| POST | `/clusters/join` | `{code}` → entra pelo convite |
| GET | `/clusters/:id` | cluster + canais + membros (membro) |
| PATCH | `/clusters/:id` | edita (dono): name, description, bannerColor, iconUrl |
| POST | `/clusters/:id/invite` | rotaciona o código de convite (dono) |

## Canais e mensagens

| Método | Rota | Descrição |
|---|---|---|
| GET | `/channels/:id` | info do canal |
| GET | `/channels/:id/messages?before=<ISO>&limit=50` | histórico (mais recentes primeiro) |
| POST | `/channels/:id/messages` | `{content, replyTo?}` → envia (rate limit 30/min, respeita slowmode/lock) |
| PATCH | `/messages/:id` | `{content}` → edita (autor) |
| DELETE | `/messages/:id` | apaga (autor) |
| GET | `/channels/:id/search?q=...` | busca com filtros: `de:usuario antes:2026-01-01 depois:2025-12-31 termo livre` |

## Amigos (Fase 2)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/friends` | `{friends, incoming, outgoing}` — amigos e pedidos |
| POST | `/friends/requests` | `{username}` → envia pedido (auto-aceita se já há pedido inverso) |
| POST | `/friends/requests/:id/accept` | aceita (destinatário) |
| POST | `/friends/requests/:id/decline` | recusa (destinatário) ou cancela (remetente) |
| DELETE | `/friends/:userId` | desfaz a amizade |

## Mensagens diretas (Fase 2)

DMs exigem amizade ou cluster em comum. 1 usuário = conversa 1:1 (reusa se existir); vários = grupo de até 10.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/dms` | minhas conversas (com participantes e última mensagem) |
| POST | `/dms` | `{userIds: [uuid...], name?}` → abre/cria conversa |
| GET | `/dms/:id/messages?before=<ISO>&limit=50` | histórico da conversa |
| POST | `/dms/:id/messages` | `{content}` → envia (rate limit 30/min) |
| PATCH | `/dm-messages/:id` | `{content}` → edita (autor) |
| DELETE | `/dm-messages/:id` | apaga (autor) |

## Perfil e presença (Fase 2)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/users/:username` | perfil público: user, bio, relationship (`none\|pending_out\|pending_in\|friends`), sharedClusters |
| PATCH | `/users/me` | `{displayName?, bio?, bannerColor?, avatarUrl?, customStatus?, status?}` |

`status`: `online \| idle \| dnd \| invisible` (presença ao vivo também muda via WebSocket).

## WebSocket — `/ws?token=<accessToken>`

Cliente → servidor:
```json
{"type": "subscribe", "channel": "<channelId>"}
{"type": "unsubscribe", "channel": "<channelId>"}
{"type": "typing", "channel": "<channelId>"}
{"type": "subscribe-dm", "conversation": "<convId>"}
{"type": "unsubscribe-dm", "conversation": "<convId>"}
{"type": "dm-typing", "conversation": "<convId>"}
{"type": "subscribe-cluster", "cluster": "<clusterId>"}
{"type": "unsubscribe-cluster", "cluster": "<clusterId>"}
{"type": "presence", "status": "online|idle|dnd|invisible"}
```
O tópico pessoal (`vyre:user:<seuId>`) é assinado automaticamente na conexão — é por ele que chegam pedidos de amizade, novas DMs e presença dos amigos. Ao conectar, o servidor também anuncia seu status para os clusters e amigos; ao desconectar (última sessão, após 5s), anuncia `offline`.

Servidor → cliente:
```json
{"type": "ready", "userId": "..."}
{"type": "message:created", "message": {id, channelId, author, content, ...}}
{"type": "message:edited", "message": {...}}
{"type": "message:deleted", "id": "...", "channelId": "..."}
{"type": "typing", "channel": "...", "userId": "..."}
{"type": "presence:update", "userId": "...", "status": "online|idle|dnd|invisible|offline"}
{"type": "friend:request", "from": {PublicUser}}
{"type": "friend:accepted", "user": {PublicUser}}
{"type": "friend:removed", "userId": "..."}
{"type": "dm:created", "conversation": {id, participants, lastMessage, ...}}
{"type": "dm:typing", "conversation": "...", "userId": "..."}
{"type": "dm:message:created", "conversationId": "...", "message": {...}}
{"type": "dm:message:edited", "conversationId": "...", "message": {...}}
{"type": "dm:message:deleted", "conversationId": "...", "id": "..."}
{"type": "error", "message": "..."}
```
Obs.: `invisible` é anunciado como `offline` para os outros (igual Discord); o próprio usuário recebe o status real.

## Fase 3: voz (LiveKit)

Canais de voz usam LiveKit (self-hosted neste VPS). A API só emite tokens e recebe os webhooks — a mídia (UDP 50000-60000) vai direto do navegador pro LiveKit (`voz.vyre.zeninhost.xyz`, DNS-only).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/voice/token` | `{channelId}` → `{url, token}` — JWT do LiveKit (sala = id do canal, identidade = userId, canPublish/canSubscribe). Exige membro do cluster e `type='voice'` |
| GET | `/voice/:channelId` | Participantes atuais do canal de voz (`{participants: [{userId, username, displayName, avatarUrl}]}`) |
| POST | `/voice/webhook` | Webhook do LiveKit (rota aberta; autenticada pelo JWT de webhook no header `Authorization`, `kid` = API key). Eventos: `participant_joined`, `participant_left`, `room_finished` |

Evento WS (tópico do cluster):

```json
{"type": "voice:update", "channelId": "...", "participants": [{"userId": "...", "username": "...", "displayName": "...", "avatarUrl": null}]}
```

Indicador de "falando" é calculado localmente no cliente (LiveKit `ActiveSpeakersChanged`) — não passa pelo servidor.

## Fase 4: gestão, moderação e mídia

**Papéis no cluster:** `owner` (dono), `moderator`, `member` (`cluster_members.role`). Dono: tudo. Mod: canais, moderação de mensagens e membros. Member: lê/escreve (dentro das regras do canal).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/uploads` | multipart `file` (PNG/JPEG/GIF/WebP, 8MB) → `{url}` (`https://vyre.zeninhost.xyz/uploads/<arq>`). Servido também em `app.vyre…/uploads/*` |
| POST | `/clusters/:id/channels` | mod+ · `{name, type, topic?}` → cria canal (`text\|voice\|announcement\|forum`) |
| PATCH | `/channels/:id` | mod+ · `{name?, topic?, type?, slowmodeSeconds?, locked?, move?: 'up'\|'down'}` → `{channel, channels}` |
| DELETE | `/channels/:id` | mod+ · nunca apaga o último canal do cluster (400) |
| PUT | `/clusters/:id/members/:userId/role` | só dono · `{role: 'moderator'\|'member'}` |
| DELETE | `/clusters/:id/members/:userId` | kick (mod kicka `member`; dono kicka qualquer um exceto a si) |
| DELETE | `/clusters/:id` | só dono · apaga cluster (cascade) e avisa todo mundo |
| POST | `/clusters/:id/invite` | só dono · regenera o código |

**Regras de mensagem:**
- `type='voice'` → 403 (não aceita mensagens).
- `type='announcement'` → só dono/mod publica (403 pros members).
- `locked=true` → 403 pra todo mundo.
- `attachments`: até 4 `{url, name}` — a URL **tem** que começar com `{publicUrl}/uploads/` (senão 400); `content` pode vir vazio se houver anexo.
- Apagar mensagem: autor **ou** mod/dono do cluster.

**Eventos WS novos:**

```json
{"type": "cluster:removed", "clusterId": "..."}
```

Disparado quando você é kickado ou o cluster é apagado (tópico do usuário + tópico do cluster). O cliente remove o cluster da UI e navega pra outro.

**GET `/clusters/:id`** agora devolve `myRole` e `members[].role`.

## Exemplo completo (curl)

```bash
B=https://app.vyre.zeninhost.xyz/api/v1
TOKEN=$(curl -s -X POST $B/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"voce@email.com","password":"sua_senha"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

curl -s $B/clusters -H "Authorization: Bearer $TOKEN"
```

## Erros

Respostas de erro vêm no formato `{"error": "mensagem"}` com o código HTTP correspondente:
`400` dados inválidos · `401` não autenticado · `403` sem permissão · `404` não encontrado · `409` conflito (usuário/email) · `429` rate limit
