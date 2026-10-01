"""Pure rule-selection checks for Phase 5; no database required."""
import pytest

from production import select_rate_rule


def row(id_, *, country="", kind="any", lo=None, hi=None):
    return {
        "id": id_, "card_country": country, "submission_type": kind,
        "range_min": lo, "range_max": hi,
    }


def test_exact_country_type_and_range_outrank_general_fallback():
    rows = [
        row("general"),
        row("us-physical-fixed", country="US", kind="physical"),
        row("us-physical-range", country="US", kind="physical", lo=400, hi=500),
    ]
    assert select_rate_rule(rows, "US", "physical", 450)["id"] == "us-physical-range"
    assert select_rate_rule(rows, "US", "physical", 300)["id"] == "us-physical-fixed"


def test_range_is_total_face_value_not_single_card_value():
    rows = [row("fifty-batch", country="US", kind="physical", lo=400, hi=500)]
    assert select_rate_rule(rows, "US", "physical", 400)["id"] == "fifty-batch"
    assert select_rate_rule(rows, "US", "physical", 50) is None


def test_wrong_country_or_type_does_not_match_specific_rule():
    rows = [row("us-code", country="US", kind="ecode", lo=100, hi=500)]
    assert select_rate_rule(rows, "UK", "ecode", 100) is None
    assert select_rate_rule(rows, "US", "physical", 100) is None


def test_equally_specific_overlapping_rules_are_rejected():
    rows = [
        row("a", country="US", kind="physical", lo=300, hi=500),
        row("b", country="US", kind="physical", lo=400, hi=600),
    ]
    with pytest.raises(ValueError, match="Multiple equally specific"):
        select_rate_rule(rows, "US", "physical", 450)
