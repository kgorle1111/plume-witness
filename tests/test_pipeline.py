"""Pipeline tests: contract gate, the real-night golden case, and the safety rules that protect named facilities."""

import json
from datetime import date
from pathlib import Path

import pytest

from pipeline import build
from pipeline.contract import validate

ROOT = Path(__file__).resolve().parent.parent
INEOS_REGISTRY_ID = "110000462623"  # EPA ECHO registry id for INEOS Americas Pasadena Site


@pytest.fixture(scope="module")
def real_event() -> dict:
    return build.build()


def test_fixture_passes_contract():
    fx = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    fx_errors = [e for e in validate(fx) if "in_corridor" not in e and "matched_facility_id" not in e
                 and "search_scope" not in e]
    assert fx_errors == []


def test_real_event_passes_contract(real_event):
    assert validate(real_event) == []
    assert real_event["label"] == "real" and real_event["provenance"]


def test_golden_detection_on_real_night(real_event):
    d = real_event["detection"]
    assert (d["site_id"], d["hour_cst"], d["value"]) == ("48_201_0069", 9, 51.75)


def test_triggered_monitors_are_downwind_pair_not_nearest(real_event):
    trig = {m["name"] for m in real_event["monitors"] if m["triggered"]}
    assert trig == {"Houston Milby Park", "Manchester East Ave N"}


def test_reporting_facility_is_in_corridor_and_matched(real_event):
    ids = [f["id"] for f in real_event["facilities"]]
    assert INEOS_REGISTRY_ID in ids
    rc = real_event["record_check"]
    assert rc["matched_facility_id"] == INEOS_REGISTRY_ID
    assert [c["status"] for c in rc["checks"]] == ["reported", "reported"]
    assert rc["reported"]["pounds"] == 7634.0


def _outside(incident: str) -> dict:
    return {"incident": incident, "entity": "Elsewhere Plant", "rn": "RN0", "start_local": "2024-06-21T09:00",
            "compound": "Benzene", "pounds": 1.0, "facility_id": "X", "distance_km": 30.0, "bearing_deg": 200.0,
            "in_corridor": False, "resolution": "outside the corridor"}


def test_absence_is_never_claimed_from_incomplete_search():
    rc = build.record_check([], {}, date(2024, 6, 21), 9, search_complete=False, param="45201")
    assert rc["status"] == "search_incomplete"
    assert rc["matched_facility_id"] is None
    assert all(c["status"] == "search_incomplete" for c in rc["checks"])


def test_absence_needs_every_incident_located():
    unresolved = _outside("1") | {"in_corridor": None, "resolution": "unresolved: facility not located"}
    rc = build.record_check([unresolved], {}, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True)
    assert rc["status"] == "search_incomplete"


def test_absence_only_with_complete_search_and_all_located():
    rc = build.record_check([_outside("1")], {}, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True)
    assert rc["status"] == "no_report_after_deadline"


def test_day_search_places_other_report_outside_corridor(real_event):
    day = {d["incident"]: d for d in real_event["record_check"]["day_incidents"]}
    assert set(day) == {"425347", "425367"}
    assert day["425367"]["in_corridor"] is False and day["425347"]["in_corridor"] is True
    assert "complete" in real_event["record_check"]["search_scope"]


def test_corridor_lists_by_distance_not_by_blame(real_event):
    dists = [f["distance_km"] for f in real_event["facilities"]]
    assert dists == sorted(dists)
    assert all(f["in_corridor"] for f in real_event["facilities"])


def test_banned_words_rejected():
    ev = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    ev["packet"]["draft_en"] = "This facility made an illegal release."
    assert any("illegal" in e for e in validate(ev))


def test_real_event_without_corridor_fails_contract(real_event):
    broken = {k: v for k, v in real_event.items() if k != "corridor"}
    assert any("corridor" in e for e in validate(broken))


def test_corridor_lists_each_facility_once(real_event):
    ids = [f["id"] for f in real_event["facilities"]]
    assert len(ids) == len(set(ids))


def _inside(incident: str, lbs: dict, report_type: str = "FINAL", report_date: str = "2024-07-03") -> tuple[dict, dict]:
    placed = {"incident": incident, "entity": "Upwind Plant", "rn": "RN1", "start_local": "2024-06-21T09:38",
              "compound": "X", "pounds": 1.0, "facility_id": "F", "distance_km": 3.0, "bearing_deg": 77.0,
              "in_corridor": True, "resolution": "in the corridor"}
    detail = {"incident": incident, "entity": "Upwind Plant", "start_local": "2024-06-21T09:38",
              "end_local": "2024-06-21T10:42", "notified_local": "2024-06-21T14:38", "compound": "X", "pounds": 1.0,
              "cause": None, "lbs_by_param": lbs, "report_type": report_type, "report_date": report_date}
    return placed, {incident: detail}


def test_report_must_list_the_monitored_compound():
    placed, details = _inside("9", {"45201": 0.0, "43218": 0.0})
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "reported_mismatch" and rc["compound_match"] is False
    placed, details = _inside("9", {"45201": 7634.0, "43218": 0.0})
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "reported" and rc["compound_match"] is True


def test_final_check_compares_the_report_date():
    # A FINAL report dated after the window is on file, so it is "reported_late", never "not yet reported".
    for rtype, rdate, want in (("FINAL", "2024-07-03", "reported"), ("FINAL", "2024-07-20", "reported_late"),
                               ("INITIAL", "2024-06-22", "not_yet_reported")):
        placed, details = _inside("9", {"45201": 5.0}, rtype, rdate)
        rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
        assert rc["checks"][1]["status"] == want, (rtype, rdate)


def test_ineos_page_parses_report_fields():
    from pipeline.parse import steers_incident
    inc = steers_incident(ROOT / "data" / "raw" / "steers_425347.html")
    assert inc["report_type"] == "FINAL" and inc["report_date"] == "2024-07-03"
    assert inc["lbs_by_param"]["45201"] == 7634.0


def test_report_started_the_day_before_and_still_running_matches():
    placed, details = _inside("7", {"45201": 40.0})
    details["7"] |= {"start_local": "2024-06-20T20:00", "end_local": "2024-06-21T11:00",
                     "notified_local": "2024-06-20T21:00"}
    placed["start_local"] = "2024-06-20T20:00"
    rc = build.record_check([], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            ongoing=[placed], earlier_complete=True)
    assert rc["status"] == "reported" and rc["incident"] == "7"
    assert rc["reported"]["match_basis"] == "ongoing (started 2024-06-20)"
    assert [p["incident"] for p in rc["ongoing_incidents"]] == ["7"]


def test_same_day_report_running_through_the_window_matches():
    placed, details = _inside("8", {"45201": 3.0})
    details["8"] |= {"start_local": "2024-06-21T00:30", "end_local": "2024-06-21T12:00"}
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            earlier_complete=True)
    assert rc["status"] == "reported" and rc["incident"] == "8"


def test_earlier_report_that_ended_before_the_window_does_not_match():
    placed, details = _inside("6", {"45201": 40.0})
    details["6"] |= {"start_local": "2024-06-20T01:00", "end_local": "2024-06-21T03:00"}
    rc = build.record_check([], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                            ongoing=[placed], earlier_complete=True)
    assert rc["status"] == "no_report_after_deadline" and rc["ongoing_incidents"] == []


def test_absence_needs_the_earlier_days_searched():
    rc = build.record_check([_outside("1")], {}, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "search_incomplete"
    assert "earlier days were not searched" in rc["search_scope"]


def test_t24_counts_from_discovery_not_from_the_spike():
    placed, details = _inside("5", {"45201": 5.0})
    details["5"] |= {"start_local": "2024-06-21T00:00", "end_local": "2024-06-21T13:00",
                     "notified_local": "2024-06-22T06:00"}
    rc = build.record_check([placed], details, date(2024, 6, 21), 11, search_complete=True, param="45201")
    assert rc["checks"][0]["status"] == "reported_late"  # the notice is on file, 30 h after discovery
    assert "30.0 h after the reported discovery" in rc["checks"][0]["note"]


def _matched_packet(real_event: dict, start: str, end: str, hour: int = 9, lbs: dict | None = None,
                    first: tuple[str, float] = ("Benzene", 40.0)) -> tuple[dict, dict]:
    """record_check + template_packet for one in-corridor report, on the demo night's monitors and wind."""
    placed, details = _inside("7", lbs or {"45201": 40.0})
    details["7"] |= {"start_local": start, "end_local": end, "notified_local": start,
                     "compound": first[0], "pounds": first[1]}
    placed["start_local"] = start
    ongoing = start[:10] < "2024-06-21"
    rc = build.record_check([] if ongoing else [placed], details, date(2024, 6, 21), hour, search_complete=True,
                            param="45201", ongoing=[placed] if ongoing else [], earlier_complete=True)
    det = real_event["detection"] | {"hour_cst": hour}
    return rc, build.template_packet(det, real_event["monitors"], real_event["wind"], real_event["facilities"], rc)


def test_matched_packet_says_when_a_report_that_was_already_running_ran(real_event):
    """Review H1: night 2024-04-21 said report 421635 ran "from 10:37 to 17:00 local time that day" and "lines up"
    with a 2:00 a.m. spike; the report ran from 2024-04-20 10:37 to 2024-04-25 17:00."""
    rc, pkt = _matched_packet(real_event, "2024-06-20T10:37", "2024-06-25T17:00")
    assert rc["status"] == "reported" and rc["reported"]["match_basis"] == "ongoing (started 2024-06-20)"
    en, es = pkt["draft_en"], pkt["draft_es"]
    assert "for a release that started 2024-06-20 10:37 and, per the report, ran until 2024-06-25 17:00 local time" in en
    assert "40 pounds of benzene for the whole release, not for these hours" in en
    assert "que empezó el 2024-06-20 10:37 y que, según el reporte, siguió hasta el 2024-06-25 17:00, hora local" in es
    assert "40 libras de benceno para toda la emisión" in es
    assert "that day" not in en and "ese día" not in es and "line up" not in en and "coinciden" not in es


def test_matched_packet_gives_dates_when_the_release_did_not_stay_on_the_spike_day(real_event):
    _, pkt = _matched_packet(real_event, "2024-06-21T08:00", "2024-06-22T02:00")
    assert "a release that started at 08:00 that day and, per the report, ran until 2024-06-22 02:00" in pkt["draft_en"]
    assert "empezó a las 08:00 ese día y que, según el reporte, siguió hasta el 2024-06-22 02:00" in pkt["draft_es"]
    # A 23:00 CST spike in June is 00:00 CDT the next day; a report that began after midnight is dated, not "that day".
    _, pkt = _matched_packet(real_event, "2024-06-22T00:30", "2024-06-22T01:30", hour=23)
    assert "a release that, per the report, ran from 2024-06-22 00:30 to 2024-06-22 01:30 local time" in pkt["draft_en"]
    assert "local time that day" not in pkt["draft_en"] and ", hora local, ese día" not in pkt["draft_es"]


def test_matched_packet_keeps_the_same_day_wording_on_the_demo_night(real_event):
    en = real_event["packet"]["draft_en"]
    assert ("filed emissions-event report 425347 for 7,634 pounds of benzene from 09:38 to 10:42 local time that "
            "day. The reported release window and the wind line up with these readings") in en


def test_matched_packet_quotes_the_monitored_compounds_pounds(real_event):
    """Review M1: the amount came from the report's first contaminant line, and the Spanish text called it benzene.
    A report listing CO first and benzene on two emission points must quote benzene's total, in both languages."""
    rc, pkt = _matched_packet(real_event, "2024-06-21T09:38", "2024-06-21T10:42", lbs={"45201": 12.5},
                              first=("Carbon Monoxide", 370.0))
    assert rc["reported"]["compound"] == "benzene" and rc["reported"]["pounds"] == 12.5
    assert "12.5 pounds of benzene" in pkt["draft_en"] and "12.5 libras de benceno" in pkt["draft_es"]
    assert "370" not in pkt["draft_en"] + pkt["draft_es"]
    # A mismatch still names what the report does list.
    placed, details = _inside("9", {"45201": 0.0})
    details["9"] |= {"compound": "Carbon Monoxide", "pounds": 370.0}
    rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201")
    assert rc["status"] == "reported_mismatch" and rc["reported"]["compound"] == "Carbon Monoxide"


def test_reported_pounds_keep_the_digits_the_report_printed():
    from pipeline import backtest
    from pipeline.parse import steers_incident

    inc = steers_incident(backtest.BT / "steers_421635.html")
    assert inc["lbs_exact"]["43218"] == 8469.74326 and inc["lbs_by_param"]["43218"] == 8469.743


def _demo_inputs(speed_mph: float | None = None) -> tuple:
    cfg, raw = build.EVENT, build.RAW
    monitors = build.load_monitors(cfg)
    wind = build.load_wind(cfg["wind_site"], cfg["year"], cfg["day"])
    if speed_mph is not None:
        for h in (8, 9):
            wind["hourly"][h]["speed_mph"] = speed_mph
    echo = json.loads((raw / cfg["echo"]).read_text())
    search = build.steers_search(raw / "steers_search_harris_06212024.html")
    details = {r["incident"]: build.steers_incident(raw / f"steers_{r['incident']}.html") for r in search["rows"]}
    rows = echo["Results"]["Facilities"] + json.loads((raw / "echo_name_425367.json").read_text())["Results"]["Facilities"]
    return monitors, {cfg["wind_site"]: wind}, echo, rows, details


def test_calm_wind_draws_no_corridor_and_claims_nothing():
    monitors, winds, echo, rows, details = _demo_inputs(speed_mph=2.0)
    t = build.trace(monitors, winds, "48_201_0069", echo, rows, details, True, date(2024, 6, 21), "45201",
                    earlier={}, earlier_complete=True, earlier_note="Earlier days searched.")
    rc = t["record_check"]
    assert t["facilities"] == [] and t["calm_mph"] == 2.0
    assert rc["status"] == "search_incomplete" and rc["matched_facility_id"] is None
    assert "Wind too light to trace (2 mph)" in rc["search_scope"]
    assert rc["checks"][0]["note"] == "wind too light to trace (2 mph)"
    assert all(d["in_corridor"] is None for d in rc["day_incidents"])
    # Review M2: calm marks every report untraced; that must not read as "a report could not be located".
    assert rc["day_incidents"] and "could not be located" not in rc["search_scope"]
    # UI audit 3, S56: with no corridor drawn the draft must not ask about "this corridor".
    pkt = build.template_packet(t["detection"], monitors, t["wind"], t["facilities"], rc)
    assert "corridor reported" not in pkt["draft_en"] and "este corredor" not in pkt["draft_es"]
    assert "near the monitor reported a release" in pkt["draft_en"]


def test_travel_time_on_the_golden_night(real_event):
    r = real_event["record_check"]["reported"]
    assert (r["travel_distance_km"], r["travel_speed_mph"]) == (10.6, 6.8)
    assert r["travel_h"] == pytest.approx(0.97, abs=0.01)
    assert r["start_to_spike_h"] == pytest.approx(0.37, abs=0.01)
    assert r["spike_hour_local"][0] <= r["arrival_local"] <= r["spike_hour_local"][1]


def test_banned_words_rejected_in_cannot_say():
    ev = json.loads((ROOT / "data" / "fixtures" / "event.fixture.json").read_text())
    ev["cannot_say"] = ["A missing report would not mean illegal."]
    assert any("illegal" in e for e in validate(ev))
    ev["cannot_say"] = ["This reading proves nothing about the plant."]
    assert any("proves" in e for e in validate(ev))


def test_ineos_page_revision_is_parsed_with_its_date():
    from pipeline.parse import steers_incident
    inc = steers_incident(ROOT / "data" / "raw" / "steers_425347.html")
    assert inc["revisions"] == [{"date": "2024-12-11", "text": (
        "The Basis Used to Determine Quantities field states 24,476 lbs. of vapor emissions and that should also be "
        "7,634 pounds.")}]
    assert len(inc["revisions"][0]["text"]) <= 120


def test_revision_parser_skips_unquoted_updates_and_bad_dates():
    from pipeline.parse import steers_revisions
    assert steers_revisions("UPDATE (5/30/2024): the flare returned to normal. Basis Used to Determine Quantities") == []
    assert steers_revisions('UPDATE VIA EMAIL ON 13/45/2024: "x" Initial') == []
    assert steers_revisions('A UPDATE VIA EMAIL ON 01/02/2025: "one" and UPDATE VIA EMAIL ON 01/09/2025: “two” Next') == [
        {"date": "2025-01-02", "text": "one"}, {"date": "2025-01-09", "text": "two"}]


def test_revision_reaches_the_event_only_when_the_page_has_one():
    ev = json.loads((ROOT / "web" / "public" / "event.json").read_text())
    assert ev["record_check"]["reported"]["revisions"][0]["date"] == "2024-12-11"


def test_mismatch_sentence_follows_the_match_basis():
    # A report that started weeks earlier must not be described as starting near the spike hour.
    night = json.loads((ROOT / "web" / "public" / "nights" / "2024-04-30_43218_48_201_0069.json").read_text())
    rc = night["record_check"]
    assert rc["status"] == "reported_mismatch" and rc["reported"]["match_basis"].startswith("ongoing")

    def drafts(rc: dict) -> tuple[str, str]:
        p = build.template_packet(night["detection"], night["monitors"], night["wind"], night["facilities"], rc,
                                  "04/30/2024", "43218")
        return p["draft_en"], p["draft_es"]

    en, es = drafts(rc)
    assert "starting near that hour" not in en and "cerca de esa hora" not in es
    assert "started 2024-04-04" in en and "per the report, ran until 2024-04-30 07:00 local time" in en
    assert "empezó el 2024-04-04" in es and "hasta el 2024-04-30 07:00, hora local" in es
    same_day = rc | {"reported": rc["reported"] | {"start_local": "2024-04-30T05:10", "end_local": "2024-04-30T09:00",
                                                   "match_basis": "started near the spike"}}
    en, es = drafts(same_day)
    assert "from 05:10 to 09:00 local time that day" in en and "started 2024" not in en
    assert "de 05:10 a 09:00, hora local, ese día" in es


def test_matched_sentence_is_hedged_and_es_uses_the_ui_terms(real_event):
    # UI audit 3, S60: "consistent with that release reaching the monitors" read as blaming the filer.
    # S62: ES used "informe" and "permitidas importantes" where the UI says "reporte" and "viento arriba".
    pkt = real_event["packet"]
    assert ("The reported release window and the wind line up with these readings; other sources may also "
            "contribute.") in pkt["draft_en"]
    assert ("El horario de la emisión reportada y el viento coinciden con estas lecturas; otras fuentes también "
            "pueden contribuir.") in pkt["draft_es"]
    assert "reaching the monitors" not in pkt["draft_en"] and "consistentes" not in pkt["draft_es"]
    assert "informe" not in pkt["draft_es"] and "permitidas" not in pkt["draft_es"]
    assert "instalaciones grandes con permiso en el corredor viento arriba" in pkt["draft_es"]


def test_wind_degrees_drop_a_whole_decimal_but_never_round(real_event):
    def wind_sentence(deg: float) -> tuple[str, str]:
        wind = real_event["wind"] | {"hourly": [h | {"from_deg": deg} for h in real_event["wind"]["hourly"]]}
        p = build.template_packet(real_event["detection"], real_event["monitors"], wind, real_event["facilities"],
                                  real_event["record_check"])
        return p["draft_en"], p["draft_es"]

    en, es = wind_sentence(77.0)
    assert "came from 77 degrees" in en and "venía de 77 grados" in es
    en, es = wind_sentence(77.5)  # rounding to 78 would put a number in the draft that is not in the facts
    assert "came from 77.5 degrees" in en and "venía de 77.5 grados" in es


def test_demo_search_completeness_comes_from_the_search_page(monkeypatch):
    real = build.steers_search
    monkeypatch.setattr(build, "steers_search", lambda p: real(p) | {"total": 60})  # a capped, partial listing
    assert "search incomplete" in build.build()["record_check"]["search_scope"]


def test_report_at_a_multi_name_echo_site_is_named_as_its_filer():
    """Night 2024-04-21: Shell Chemical's report 421635 sits at ECHO registry 110031267064, which ECHO lists under
    five permit holders' names, Airgas first. The corridor kept the first row's name, so the Check step said
    "Airgas Carbonic Deer Park Plant · Filed report #421635" for a report Shell filed (UI audit 3, S01)."""
    from pipeline import backtest
    from pipeline.parse import steers_incident

    bt = backtest.BT
    echo = json.loads((bt / "echo_48_201_0069_10mi.json").read_text())
    _, echo_rows = backtest.load_echo()
    inc = steers_incident(bt / "steers_421635.html")
    assert inc["entity"] == "SHELL CHEMICAL"
    origin = backtest.site_coords("48_201_0069")
    facs = build.corridor(echo, origin, [86.0], build.site_names(echo_rows))
    site = next(f for f in facs if f["id"] == "110031267064")
    assert site["name"] == SHELL_SITE  # every holder, until a report names the filer
    placed = build.place_incidents([inc], facs, echo_rows, origin, [86.0])
    assert placed[0]["facility_id"] == "110031267064" and placed[0]["entity"] == "Shell Chemical"
    rc = build.record_check([], {"421635": inc}, date(2024, 4, 21), 2, search_complete=True, param="43218",
                            ongoing=placed, earlier_complete=True)
    assert rc["status"] == "reported" and rc["matched_facility_id"] == "110031267064"
    build.name_filer(facs, rc, echo["Results"]["Facilities"])
    # What the Check step prints beside "Filed report #421635" is the company that filed it.
    assert site["name"] == rc["reported"]["facility"] == "Shell Chemical"
    assert site["echo_names"] == ["Airgas Carbonic Deer Park Plant", "Deer Park Oil Refinery", "Deer Park VCM Plant",
                                  "Shell Chemical", "Westlake Epoxy Deer Park"]


SHELL_SITE = ("Airgas Carbonic Deer Park Plant / Deer Park Oil Refinery / Deer Park VCM Plant / Shell Chemical / "
              "Westlake Epoxy Deer Park")
EQUISTAR_SITE = "Channelview Cogeneration Facility / Equistar Chemicals Channelview Complex"


def test_a_multi_holder_site_is_named_by_every_holder_not_its_first_row():
    """Review H2: the corridor named EPA registry 110031267064 (5 permit holders at 5900 Highway 225) "Airgas Carbonic
    Deer Park Plant" on 65 nights, the demo night among them, and 110000463212 "Channelview Cogeneration Facility" on
    27, from whichever ECHO row came first. A site is named by all its holders, as on its facility page."""
    from pipeline import backtest

    _, echo_rows = backtest.load_echo()
    names = build.site_names(echo_rows)

    def sites(monitor: str, wind: float, all_names: bool = True) -> dict[str, dict]:
        echo = json.loads((backtest.BT / f"echo_{monitor}_10mi.json").read_text())
        facs = build.corridor(echo, backtest.site_coords(monitor), [wind], names if all_names else None)
        return {f["id"]: f for f in facs}

    milby = sites("48_201_0069", 86.0)  # the 2024-04-21 night's corridor
    assert milby["110031267064"]["name"] == SHELL_SITE
    assert sites("48_201_0026", 14.0)["110000463212"]["name"] == EQUISTAR_SITE  # 2024-11-09's corridor
    # From one monitor's file alone it still lists every holder that file has, never one of them alone.
    assert sites("48_201_0069", 86.0, all_names=False)["110031267064"]["name"] == SHELL_SITE
    # A one-holder site keeps its own name.
    one = next(f for f in milby.values() if len(names.get(f["id"], [])) == 1)
    assert " / " not in one["name"]


def test_published_nights_name_multi_holder_sites_like_their_facility_pages():
    """Every corridor site with several ECHO permit holders reads as its facility page does (all holders), except
    the site whose report matched, which reads as the filer (test below). Includes the demo night."""
    from pipeline.names import display_name

    index = json.loads((ROOT / "web" / "public" / "facilities" / "index.json").read_text())["facilities"]
    multi = {f["id"]: " / ".join(display_name(n) for n in f["name"].split(" / ")) for f in index if " / " in f["name"]}
    assert multi["110031267064"] == SHELL_SITE and multi["110000463212"] == EQUISTAR_SITE
    paths = sorted((ROOT / "web" / "public" / "nights").glob("2*.json"))
    paths += sorted((ROOT / "web" / "public" / "regions").glob("*/nights/2*.json"))
    paths.append(ROOT / "web" / "public" / "event.json")
    seen: dict[str, int] = {}
    for p in paths:
        ev = json.loads(p.read_text())
        for f in ev["facilities"]:
            if f["id"] in multi and f["id"] != ev["record_check"]["matched_facility_id"]:
                assert f["name"] == multi[f["id"]], (p.name, f["name"])
                seen[f["id"]] = seen.get(f["id"], 0) + 1
    demo = json.loads((ROOT / "web" / "public" / "event.json").read_text())
    assert next(f for f in demo["facilities"] if f["id"] == "110031267064")["name"] == SHELL_SITE
    assert seen["110031267064"] >= 65 and seen["110000463212"] >= 27


def test_published_nights_name_the_filer_of_the_matched_report():
    """Every published night: the facility the Check step names beside the report is the report's own filer."""
    paths = sorted((ROOT / "web" / "public" / "nights").glob("2*.json"))
    paths += sorted((ROOT / "web" / "public" / "regions").glob("*/nights/2*.json"))
    paths.append(ROOT / "web" / "public" / "event.json")
    checked = 0
    for p in paths:
        ev = json.loads(p.read_text())
        rc = ev["record_check"]
        if not rc["matched_facility_id"]:
            continue
        f = next(x for x in ev["facilities"] if x["id"] == rc["matched_facility_id"])
        assert f["name"] == rc["reported"]["facility"], (p.name, f["name"], rc["reported"]["facility"])
        checked += 1
    assert checked >= 18



def test_published_checks_never_say_not_yet_once_a_record_exists():
    """UI audit 3, S02: nights 2025-01-23 (before #91) and 2024-01-09 showed "Not yet reported" for notices filed
    26.9 h and 3029 h after discovery. A check whose note cites a filing date is never "not_yet_reported"."""
    paths = sorted((ROOT / "web" / "public" / "nights").glob("2*.json"))
    paths += sorted((ROOT / "web" / "public" / "regions").glob("*/nights/2*.json"))
    late = 0
    for p in paths:
        for c in json.loads(p.read_text())["record_check"]["checks"]:
            filed = c["note"].startswith(("initial notice filed", "final report dated"))
            assert not (filed and c["status"] == "not_yet_reported"), (p.name, c)
            late += c["status"] == "reported_late"
    assert late >= 2  # 2024-01-09: notice 3029 h after discovery, final 133 days after the end


def _published() -> list[Path]:
    paths = sorted((ROOT / "web" / "public" / "nights").glob("2*.json"))
    paths += sorted((ROOT / "web" / "public" / "regions").glob("*/nights/2*.json"))
    return paths + [ROOT / "web" / "public" / "event.json"]


def test_published_names_keep_acronyms_and_brands():
    """UI audit 3, S57: str.title() printed "Basf", "Aes", "Ineos", "Pasadena Pvc" in the corridor and the drafts."""
    import re
    artifacts = re.compile(r"\b(Basf|Aes|Ineos|Llc|Vcm|Pvc|Kmcc|Usa|Accp|Pci|Gcl|Epolp)\b")
    seen = 0
    for p in _published():
        ev = json.loads(p.read_text())
        names = [f["name"] for f in ev["facilities"]] + [d["entity"] for d in ev["record_check"]["day_incidents"]]
        names += [ev["packet"]["draft_en"], ev["packet"]["draft_es"]]
        bad = [n for n in names if artifacts.search(n)]
        assert bad == [], (p.name, bad[:3])
        seen += len(names)
    assert seen > 5000


def test_published_nights_list_each_facility_name_once():
    """UI audit 3, S124: the demo corridor listed "Galena Park Terminal" 3 times (separate ECHO sites)."""
    for p in _published():
        names = [f["name"] for f in json.loads(p.read_text())["facilities"]]
        assert len(names) == len(set(names)), (p.name, sorted({n for n in names if names.count(n) > 1}))


def test_same_name_sites_get_a_street_then_an_epa_id(real_event):
    galena = sorted(f["name"] for f in real_event["facilities"] if f["name"].startswith("Galena Park Terminal"))
    # ECHO: 110032992215 lists 12510 then 12901 American Petroleum Road (the first row's street is used);
    # 110037844376 and 110069719665 are both at 906 Clinton Dr, so only their registry ids tell them apart.
    assert galena == ["Galena Park Terminal (12510 American Petroleum Road)",
                      "Galena Park Terminal (906 Clinton Dr, EPA 110037844376)",
                      "Galena Park Terminal (906 Clinton Dr, EPA 110069719665)"]


def test_disambiguate_leaves_the_matched_filer_name_alone():
    rows = [{"RegistryID": i, "AIRUniverse": "Major Emissions", "AIRStreet": s}
            for i, s in (("1", "901 CLINTON DR"), ("2", "906  CLINTON DR"), ("3", ""))]
    facs = [{"id": i, "name": n} for i, n in (("1", "Terminal"), ("2", "Terminal"), ("3", "Terminal"), ("4", "Plant"))]
    build.disambiguate(facs, rows, keep_id="1")
    assert [f["name"] for f in facs] == ["Terminal", "Terminal (906 Clinton Dr)", "Terminal (EPA 3)", "Plant"]


def test_template_prints_reported_pounds_unrounded():
    """Night 2024-04-21: the report gives 8469.74326 lb; "8,470" was a number the guard could not find in the facts."""
    from pipeline.gemini_draft import facts_for, guard
    night = json.loads((ROOT / "web" / "public" / "nights" / "2024-04-21_43218_48_201_0069.json").read_text())
    p = build.template_packet(night["detection"], night["monitors"], night["wind"], night["facilities"],
                              night["record_check"], "04/21/2024", "43218")
    assert "listing 8,469.74326 pounds" in p["draft_en"] and "con 8,469.74326 libras" in p["draft_es"]
    assert guard(p, facts_for(night)) == []


def test_match_window_includes_both_of_its_edges():
    """Review mutants: `end >= lo` -> `>` survived. A June spike in the 9:00 CST hour is 10:00 CDT, so the window is
    [04:00, 12:00] local: a report that ended at 04:00 or began at 12:00 was running inside it."""
    for start, end in (("2024-06-21T01:00", "2024-06-21T04:00"), ("2024-06-21T12:00", "2024-06-21T13:00")):
        placed, details = _inside("4", {"45201": 5.0})
        details["4"] |= {"start_local": start, "end_local": end, "notified_local": start}
        placed["start_local"] = start
        rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                                earlier_complete=True)
        assert rc["status"] == "reported" and rc["incident"] == "4", (start, end)
    for start, end in (("2024-06-21T01:00", "2024-06-21T03:59"), ("2024-06-21T12:01", "2024-06-21T13:00")):
        placed, details = _inside("4", {"45201": 5.0})
        details["4"] |= {"start_local": start, "end_local": end, "notified_local": start}
        placed["start_local"] = start
        rc = build.record_check([placed], details, date(2024, 6, 21), 9, search_complete=True, param="45201",
                                earlier_complete=True)
        assert rc["status"] == "no_report_after_deadline", (start, end)


def test_corridor_includes_a_site_exactly_on_its_edge():
    """Review mutants: `off > CORRIDOR_HALF_ANGLE` -> `>=` survived. A site exactly 22.5 deg off the wind is in."""
    origin, site = (29.7062725, -95.2611331), (29.7138, -95.124036)  # Milby Park; the Deer Park site 13.3 km east
    b = build.bearing_deg(origin, site)
    echo = {"Results": {"Facilities": [{"RegistryID": "1", "AIRName": "EDGE PLANT", "AIRUniverse": "Major Emissions",
                                        "FacLat": str(site[0]), "FacLong": str(site[1])}]}}
    edge = b + build.CORRIDOR_HALF_ANGLE
    assert abs((edge - b + 180) % 360 - 180) == build.CORRIDOR_HALF_ANGLE  # exactly on the edge in floating point
    assert [f["name"] for f in build.corridor(echo, origin, [edge])] == ["Edge Plant"]
    assert build.corridor(echo, origin, [edge + 0.01]) == []


def test_calm_means_below_3_mph_so_exactly_3_draws_a_corridor():
    """CALM_MPH: "below this" the direction is too unsteady (spikes.REASONS: "under 3 mph"). Exactly 3.0 mph is
    traceable: 7 published nights sit at 3.0 mph (5 of them no_report_after_deadline), and `<=` would turn those 5
    into search_incomplete. Pinned here so the threshold cannot move silently."""
    for speed, calm in ((3.0, False), (2.9, True)):
        monitors, winds, echo, rows, details = _demo_inputs(speed_mph=speed)
        t = build.trace(monitors, winds, "48_201_0069", echo, rows, details, True, date(2024, 6, 21), "45201",
                        earlier={}, earlier_complete=True, earlier_note="Earlier days searched.")
        assert (t["calm_mph"] is not None) == calm and bool(t["facilities"]) != calm, speed
