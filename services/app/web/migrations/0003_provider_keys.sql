-- One saved provider per person: which provider and model their own calls run on, and their key for it, sealed (AES-GCM) so the
-- table alone shows nothing. `last4` is the only part of the key ever shown again.
CREATE TABLE IF NOT EXISTS provider_keys (user_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, sealed TEXT NOT NULL, last4 TEXT NOT NULL, updated TEXT NOT NULL);
