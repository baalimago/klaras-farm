from backend.migrate import discover


def test_migrations_are_numbered_without_gaps_and_first_creates_bookkeeping():
    found = discover()
    assert [v for v, _, _ in found] == list(range(1, len(found) + 1))
    assert "schema_migrations" in found[0][2]
