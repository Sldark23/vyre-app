-- Vyre schema v1
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,32}$'),
  display_name text NOT NULL,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  avatar_url text,
  banner_color text NOT NULL DEFAULT '#e63946',
  bio text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'online' CHECK (status IN ('online','idle','dnd','invisible')),
  custom_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  slug text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  icon_url text,
  banner_color text NOT NULL DEFAULT '#e63946',
  owner_id uuid NOT NULL REFERENCES users(id),
  invite_code text NOT NULL UNIQUE,
  member_count int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cluster_members (
  cluster_id uuid NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, user_id)
);
CREATE INDEX IF NOT EXISTS cluster_members_user_idx ON cluster_members(user_id);

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#e63946',
  position int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_roles (
  cluster_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (cluster_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'text' CHECK (type IN ('text','voice','announcement','forum')),
  topic text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0,
  slowmode_seconds int NOT NULL DEFAULT 0,
  locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS channels_cluster_idx ON channels(cluster_id, position);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  content text NOT NULL DEFAULT '',
  edited_at timestamptz,
  reply_to uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_channel_created_idx ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_search_idx ON messages USING gin (to_tsvector('portuguese', content));

-- ============ Fase 2: amizades ============
CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_user, to_user),
  CHECK (from_user <> to_user)
);
CREATE INDEX IF NOT EXISTS friend_requests_to_idx ON friend_requests(to_user, status);

CREATE TABLE IF NOT EXISTS friendships (
  user_a uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

-- ============ Fase 2: DMs ============
CREATE TABLE IF NOT EXISTS dm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  is_group boolean NOT NULL DEFAULT false,
  name text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dm_participants (
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS dm_participants_user_idx ON dm_participants(user_id);

CREATE TABLE IF NOT EXISTS dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  content text NOT NULL DEFAULT '',
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dm_messages_conv_idx ON dm_messages(conversation_id, created_at DESC);

-- ============ Fase 3: voz (LiveKit) ============
-- Participantes conectados em canais de voz (alimentado pelos webhooks do LiveKit)
CREATE TABLE IF NOT EXISTS voice_participants (
  session_id text PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS voice_participants_channel_idx ON voice_participants(channel_id);
CREATE INDEX IF NOT EXISTS voice_participants_user_idx ON voice_participants(user_id);

-- ============ Fase 4: gestão, moderação e mídia ============
-- Papéis no cluster (dono original vira 'owner' via UPDATE abaixo)
ALTER TABLE cluster_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
  CHECK (role IN ('owner','moderator','member'));
UPDATE cluster_members m SET role = 'owner'
  FROM clusters c WHERE c.id = m.cluster_id AND c.owner_id = m.user_id AND m.role <> 'owner';

-- Anexos de imagem em mensagens (URLs geradas por /api/v1/uploads)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dm_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
