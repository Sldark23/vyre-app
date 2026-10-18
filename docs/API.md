# Vyre API — Referência (v1)

Base: `https://vyre.zeninhost.xyz` (local: `http://127.0.0.1:3100`)
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

## WebSocket — `/ws?token=<accessToken>`

Cliente → servidor:
```json
{"type": "subscribe", "channel": "<channelId>"}
{"type": "unsubscribe", "channel": "<channelId>"}
{"type": "typing", "channel": "<channelId>"}
```

Servidor → cliente:
```json
{"type": "ready", "userId": "..."}
{"type": "message:created", "message": {id, channelId, author, content, ...}}
{"type": "message:edited", "message": {...}}
{"type": "message:deleted", "id": "...", "channelId": "..."}
{"type": "typing", "channel": "...", "userId": "..."}
{"type": "error", "message": "..."}
```

## Exemplo completo (curl)

```bash
B=https://vyre.zeninhost.xyz/api/v1
TOKEN=$(curl -s -X POST $B/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"voce@email.com","password":"sua_senha"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])')

curl -s $B/clusters -H "Authorization: Bearer $TOKEN"
```

## Erros

Respostas de erro vêm no formato `{"error": "mensagem"}` com o código HTTP correspondente:
`400` dados inválidos · `401` não autenticado · `403` sem permissão · `404` não encontrado · `409` conflito (usuário/email) · `429` rate limit
