"""Phase 6 Apple US seed verification that requires no database connection."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "migrations" / "010_apple_us_rates.sql"

EXPECTED = {
    (100, 300, 500, "ecode", 107739, False),
    (50, 400, 500, "physical", 115176, True),
    (50, 100, 150, "physical", 111553, False),
    (50, 250, 251, "physical", 107167, False),
    (50, 200, 201, "physical", 111171, False),
    (25, 0, 25, "physical", 105832, False),
    (20, None, None, "ecode", 104879, False),
    (20, 0, 20, "physical", 108883, False),
    (15, 0, 15, "physical", 108120, False),
    (10, None, None, "ecode", 104879, False),
    (10, 80, 90, "physical", 108883, False),
    (10, 10, 20, "ecode", 101065, False),
    (5, 25, 80, "ecode", 101065, False),
    (5, 105, 145, "physical", 109837, False),
    (5, 155, 195, "physical", 109837, False),
    (5, 205, 240, "physical", 109837, False),
    (5, 105, 495, "ecode", 105260, False),
    (1, 105, 245, "physical", 108883, False),
}

ROW_RE = re.compile(
    r"\((\d+),\s*(NULL|\d+),\s*(NULL|\d+),\s*'(physical|ecode)',\s*(\d+),\s*(TRUE|FALSE)\)"
)

def rows():
    text = MIGRATION.read_text(encoding="utf-8")
    found = set()
    for face, lo, hi, kind, rate, headline in ROW_RE.findall(text):
        found.add((int(face), None if lo == "NULL" else int(lo), None if hi == "NULL" else int(hi), kind, int(rate), headline == "TRUE"))
    return text, found

def test_seed_matches_approved_unambiguous_reference_rows():
    text, found = rows()
    assert found == EXPECTED
    assert "Apple / iTunes catalog card must exist" in text
    assert "market_code = 'NG'" in text
    assert "'US'" in text

def test_exactly_one_headline_and_it_matches_supplied_all_cards_rate():
    _, found = rows()
    headlines = [r for r in found if r[-1]]
    assert headlines == [(50, 400, 500, "physical", 115176, True)]

def test_seeded_ranged_rules_do_not_overlap_for_same_value_and_type():
    _, found = rows()
    ranged = [r for r in found if r[1] is not None]
    for i, left in enumerate(ranged):
        for right in ranged[i + 1:]:
            if left[0] != right[0] or left[3] != right[3]:
                continue
            assert max(left[1], right[1]) > min(left[2], right[2]), (left, right)

def test_ambiguous_supplied_rows_are_documented_but_not_seeded():
    text, found = rows()
    assert len(found) == 18
    assert "Supplied rows intentionally left unconfigured" in text
    # These conflicting source rows must not become active rules under the
    # current total-face-value matcher.
    assert (50, 350, 500, "physical", 111362, False) not in found
    assert (50, 100, 500, "ecode", 101065, False) not in found
    assert (5, 10, 95, "physical", 108311, False) not in found
