"""TRI context tests: linkage on a tiny synthetic example, unit handling, the year filter, form selection."""

import pytest

from pipeline import tri


def test_link_prefers_echo_triids_and_falls_back_to_registry_id():
    echo = [
        {"RegistryID": "R1", "TRIIDs": "77001AAAAA1 77001BBBBB2"},   # ECHO lists two TRIFIDs
        {"RegistryID": "R2", "TRIIDs": None},                          # none listed; TRI facility carries R2
        {"RegistryID": "R3", "TRIIDs": None},                          # nothing anywhere
    ]
    tri_facs = {"77002CCCCC3": {"epa_registry_id": "R2"}, "77009ZZZZZ9": {"epa_registry_id": "R9"}}
    out = tri.link_facilities(echo, tri_facs)
    assert out["R1"] == {"ids": ["77001AAAAA1", "77001BBBBB2"], "via": "echo_triids"}
    assert out["R2"] == {"ids": ["77002CCCCC3"], "via": "frs_registry_id"}
    assert "R3" not in out


def test_link_does_not_match_by_name():
    echo = [{"RegistryID": "R1", "TRIIDs": None, "AIRName": "ACME PLANT"}]
    assert tri.link_facilities(echo, {"77003XXXXX1": {"facility_name": "ACME PLANT", "epa_registry_id": None}}) == {}


def test_units_to_pounds():
    assert tri.to_lbs(956, "Pounds") == 956.0
    assert tri.to_lbs(453.59237, "Grams") == 1.0
    assert tri.to_lbs(None, "Pounds") is None
    assert tri.to_lbs(0, "Pounds") == 0.0  # a reported zero is a number, not a blank


def test_unknown_unit_and_bad_quantity_raise():
    with pytest.raises(ValueError, match="unit_of_measure"):
        tri.to_lbs(5, "Kilograms")
    with pytest.raises(ValueError):
        tri.to_lbs(-1, "Pounds")
    with pytest.raises(ValueError):
        tri.to_lbs(float("nan"), "Pounds")


def test_year_filter_keeps_only_requested_years():
    rows = [{"reporting_year": y} for y in ("2019", "2020", "2024", "2025", 2022)]
    assert [str(r["reporting_year"]) for r in tri.in_years(rows)] == ["2020", "2024", "2022"]
    assert tri.in_years(rows, years=(2025,)) == [{"reporting_year": "2025"}]


def test_year_entry_blank_is_not_zero():
    assert tri.year_entry(956.0, 383.0)["total_lbs"] == 1339.0
    assert tri.year_entry(None, 5.0) == {"stack_lbs": None, "fugitive_lbs": 5.0, "total_lbs": 5.0}
    assert tri.year_entry(None, None)["total_lbs"] is None


def test_pick_forms_latest_active_wins():
    f = lambda doc, rec, act="1": {"tri_facility_id": "T1", "reporting_year": "2023", "doc_ctrl_num": doc,
                                    "received_date": rec, "active_status": act}
    best = tri.pick_forms([f("A", "2024-03-01"), f("B", "2024-06-01"), f("C", "2024-09-01", act="0")])
    assert best[("T1", 2023)]["doc_ctrl_num"] == "B"


def test_release_lbs_maps_media_and_keeps_na_blank():
    rows = [{"doc_ctrl_num": "D", "environmental_medium": "AIR STACK", "total_release": 10},
            {"doc_ctrl_num": "D", "environmental_medium": "AIR FUG", "total_release": None}]
    assert tri.release_lbs(rows, "Pounds") == {"D": {"AIR STACK": 10.0, "AIR FUG": None}}


def test_clean_strips_markup_and_caps_length():
    assert tri.clean("  A<script>x</script>\n B ") == "A script x /script B"
    assert len(tri.clean("x" * 1000)) == 200
    assert tri.clean(None) is None and tri.clean("   ") is None


def test_redact_drops_personal_fields_only():
    rows = [{"doc_ctrl_num": "D", "certif_name": "A B", "public_contact_email": "a@b.c", "asgn_public_phone": "1",
             "facility_name": "X", "total_release": 5}]
    kept, gone = tri.redact(rows)
    assert kept == [{"doc_ctrl_num": "D", "facility_name": "X", "total_release": 5}]
    assert gone == ["asgn_public_phone", "certif_name", "public_contact_email"]
