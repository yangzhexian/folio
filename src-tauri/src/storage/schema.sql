CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES records(id),
    body TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS category_catalog (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    body TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attachment_record ON attachments(record_id);
