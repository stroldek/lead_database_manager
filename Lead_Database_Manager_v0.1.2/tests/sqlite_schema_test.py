from pathlib import Path
import sqlite3
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = [
    ROOT / 'migrations' / '0001_stage1_prototype.sql',
    ROOT / 'migrations' / '0002_core_management.sql',
]

with tempfile.TemporaryDirectory() as tmp:
    db_path = Path(tmp) / 'ldm.sqlite'
    conn = sqlite3.connect(db_path)
    conn.execute('PRAGMA foreign_keys = ON')
    for migration in MIGRATIONS:
        conn.executescript(migration.read_text(encoding='utf-8'))

    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    expected = {'schema_migrations', 'leads', 'consent_events', 'telegram_updates', 'segments', 'lead_segments', 'activity_logs', 'search_jobs', 'chat_queue', 'chat_history'}
    assert expected.issubset(tables), f'Missing tables: {expected - tables}'

    versions = {row[0] for row in conn.execute('SELECT version FROM schema_migrations')}
    assert versions == {'0001_stage1_prototype', '0002_core_management'}

    conn.execute("""INSERT INTO leads
      (id, telegram_id, username, first_name, source, quality, status, consent_status, extra_json)
      VALUES ('lead-1','10001','alpha','Alpha','manual','high','new','none','{\"notes\":\"Test note\"}')""")
    conn.execute("INSERT INTO leads (id, telegram_id, source) VALUES ('lead-2','10002','manual')")
    conn.execute("INSERT INTO lead_segments (lead_id, segment_id) VALUES ('lead-1','seg-mobile')")
    conn.execute("INSERT INTO lead_segments (lead_id, segment_id) VALUES ('lead-1','seg-promising')")
    conn.commit()

    memberships = conn.execute("SELECT COUNT(*) FROM lead_segments WHERE lead_id='lead-1'").fetchone()[0]
    assert memberships == 2, 'A lead must be able to belong to multiple segments'

    count = conn.execute("SELECT COUNT(*) FROM leads WHERE telegram_id='10001'").fetchone()[0]
    assert count == 1, 'telegram_id must remain unique'

    try:
        conn.execute("INSERT INTO leads (id, telegram_id) VALUES ('lead-dup','10001')")
        raise AssertionError('UNIQUE constraint did not protect telegram_id')
    except sqlite3.IntegrityError:
        pass

    conn.execute("DELETE FROM segments WHERE id='seg-mobile'")
    conn.commit()
    remaining_lead = conn.execute("SELECT id FROM leads WHERE id='lead-1'").fetchone()
    remaining_links = conn.execute("SELECT COUNT(*) FROM lead_segments WHERE lead_id='lead-1'").fetchone()[0]
    assert remaining_lead == ('lead-1',), 'Deleting a segment must not delete leads'
    assert remaining_links == 1, 'Deleting a segment should remove only its membership links'

    conn.execute("UPDATE leads SET consent_status='revoked' WHERE telegram_id='10001'")
    conn.commit()
    assert conn.execute("SELECT consent_status FROM leads WHERE telegram_id='10001'").fetchone() == ('revoked',)

    # The management migration is repeat-safe: tables, indexes and default segments use IF NOT EXISTS / OR IGNORE.
    conn.executescript(MIGRATIONS[1].read_text(encoding='utf-8'))

    print('PASS: both migrations apply in sequence')
    print('PASS: all core management tables are created')
    print('PASS: schema version registry is recorded')
    print('PASS: telegram_id uniqueness is enforced')
    print('PASS: one lead can belong to multiple segments')
    print('PASS: deleting a segment does not delete its leads')
    print('PASS: consent state remains independently stored')
    conn.close()
