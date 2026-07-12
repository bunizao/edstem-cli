ALTER TABLE users ADD COLUMN ed_user_id INTEGER;

UPDATE users
SET ed_user_id = (
  SELECT ed_user_id
  FROM ed_credentials
  WHERE ed_credentials.user_id = users.id
)
WHERE ed_user_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM ed_credentials
    WHERE ed_credentials.user_id = users.id
  );

CREATE UNIQUE INDEX IF NOT EXISTS users_ed_user_id_idx
  ON users (ed_user_id)
  WHERE ed_user_id IS NOT NULL;
