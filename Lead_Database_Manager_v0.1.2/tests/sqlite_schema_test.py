from pathlib import Path
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'migrations' / '0001_stage1_prototype.sql'

with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'stage1.sqlite'
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA foreign_keys = ON')
    conn.executescript(MIGRATION.read_text(encoding='utf-8'))

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    expected = {'schema_migrations', 'leads', 'consent_events', 'telegram_updates'}
    assert expected.issubset(tables), f'Missing tables: {expected - tables}'

    migration = conn.execute('SELECT version FROM schema_migrations').fetchone()
    assert migration == ('0001_stage1_prototype',)

    conn.execute("""INSERT INTO leads
      (id, telegram_id, username, first_name, source, quality, status,
       consent_status, consent_at, consent_source)
      VALUES ('lead-1','10001','alpha','Alpha','telegram_bot','unclassified','new',
       'granted','2026-11-12T10:00:00Z','telegram_bot:inline_consent')""")
    conn.execute("""INSERT INTO consent_events (id, lead_id, action, source, event_key)
      VALUES ('event-1','lead-1','granted','telegram_bot:inline_consent','telegram:update:10:consent')""")
    try:
        conn.execute("""INSERT INTO consent_events (id, lead_id, action, source, event_key)
          VALUES ('event-2','lead-1','granted','telegram_bot:inline_consent','telegram:update:10:consent')""")
        raise AssertionError('UNIQUE event_key did not protect duplicate consent event')
    except sqlite3.IntegrityError:
        pass
    conn.commit()

    # Duplicate Telegram ID must fail at the database level.
    try:
        conn.execute("INSERT INTO leads (id, telegram_id) VALUES ('lead-2','10001')")
        raise AssertionError('UNIQUE constraint did not protect telegram_id')
    except sqlite3.IntegrityError:
        pass

    # A lead may retain its card after consent has been revoked.
    conn.execute("UPDATE leads SET consent_status='revoked' WHERE telegram_id='10001'")
    conn.commit()
    state = conn.execute("SELECT consent_status FROM leads WHERE telegram_id='10001'").fetchone()
    assert state == ('revoked',)

    # Incoming update IDs are unique for deduplication.
    conn.execute("INSERT INTO telegram_updates (update_id, update_type) VALUES (1,'message')")
    try:
        conn.execute("INSERT INTO telegram_updates (update_id, update_type) VALUES (1,'message')")
        raise AssertionError('UNIQUE update_id did not protect duplicates')
    except sqlite3.IntegrityError:
        pass

    print('PASS: migration creates required tables')
    print('PASS: migration registry is recorded')
    print('PASS: telegram_id is unique')
    print('PASS: consent event_key is unique')
    print('PASS: consent revocation keeps the lead record')
    print('PASS: telegram update_id is unique')
    conn.close()
