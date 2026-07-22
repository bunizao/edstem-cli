CREATE TABLE IF NOT EXISTS ed_credentials (
  user_id INTEGER PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  ed_user_id INTEGER NOT NULL,
  ed_user_name TEXT NOT NULL,
  is_invalid INTEGER NOT NULL DEFAULT 0,
  last_verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
