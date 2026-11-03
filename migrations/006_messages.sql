-- Messages sent from the public Contact form.
CREATE TABLE messages (
  id TEXT PRIMARY KEY, created TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','replied'))
);
