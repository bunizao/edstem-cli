CREATE INDEX IF NOT EXISTS oauth_authorization_codes_expires_at_idx
  ON oauth_authorization_codes (expires_at);

CREATE INDEX IF NOT EXISTS oauth_authorization_codes_user_id_idx
  ON oauth_authorization_codes (user_id);

CREATE INDEX IF NOT EXISTS oauth_access_tokens_expires_at_idx
  ON oauth_access_tokens (expires_at);

CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_id_idx
  ON oauth_access_tokens (user_id);

CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_expires_at_idx
  ON oauth_refresh_tokens (expires_at);

CREATE INDEX IF NOT EXISTS oauth_refresh_tokens_user_id_idx
  ON oauth_refresh_tokens (user_id);
