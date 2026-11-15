"""Pollution rose (CPF) tests: sector edges, CPF arithmetic on a table small enough to check by hand, the rule
that a site without its own wind is skipped rather than drawn, and the real Milby Park result."""

import json
from pathlib import Path

import pytest

from pipeline import rose


@pytest.mark.parametrize("deg, idx", [(0, 0), (360, 0), (359.9, 11), (29.99, 0), (30, 1), (45, 1), (180, 6)])
def test_sector_edges(deg, idx):
    assert rose.sector(deg) == idx


@pytest.mark.parametrize("deg", [-0.1, 360.1])
def test_sector_rejects_out_of_range(deg):
    with pytest.raises(ValueError):
        rose.sector(deg)


def _tiny_tables() -> tuple[dict, dict, dict]:
    """5 days x 24 h = 120 hours. Hours 0-19 overall: wind from 45 deg; the rest from 190 deg.

    From 45 deg: 10 hours at 10 ppb, 10 at 1 ppb. From 190 deg: 80 at 1 ppb. Plus 10 calm hours (2 mph) at
    50 ppb and 10 hours with no reading, which must both be dropped before the percentile is taken.
    """
    vals, wdir, wspd = {}, {}, {}
    k = 0
    for day in ("01/01/2024", "01/02/2024", "01/03/2024", "01/04/2024", "01/05/2024"):
        v, d, s = [], [], []
        for _ in range(24):
            if k < 10:
                v.append(10.0), d.append(45.0), s.append(5.0)
            elif k < 20:
                v.append(1.0), d.append(45.0), s.append(5.0)
            elif k < 100:
                v.append(1.0), d.append(190.0), s.append(5.0)
            elif k < 110:
                v.append(50.0), d.append(45.0), s.append(2.0)
            else:
                v.append(None), d.append(190.0), s.append(5.0)
            k += 1
        vals[day], wdir[day], wspd[day] = v, d, s
    return vals, wdir, wspd


def test_cpf_on_tiny_table():
    pairs, dropped = rose.paired_hours(*_tiny_tables())
    assert len(pairs) == 100 and dropped == {"no_reading": 10, "no_wind": 0, "calm": 10}
    r = rose.cpf(pairs)
    # 90 values of 1 and 10 of 10: the 90th percentile sits between them (1 + 0.1 * 9), so the 10 tens are high.
    assert r["thresholds_ppb"]["p90"] == pytest.approx(1.9)
    s1, s6 = r["sectors"][1], r["sectors"][6]
    assert (s1["hours"], s1["share_of_hours"]) == (20, 0.2)
    assert (s6["hours"], s6["share_of_hours"]) == (80, 0.8)
    assert s1["p90"]["high_hours"] == 10 and s1["p90"]["high_days"] == 1
    assert s1["p90"]["cpf"] == 0.5  # P(high | wind from 30-60) = 10 of 20, not 10 of all 10 high hours
    assert s1["p90"]["share_of_high"] == 1.0
    assert s6["p90"]["cpf"] == 0.0
    assert r["sectors"][0]["hours"] == 0 and r["sectors"][0]["p90"]["cpf"] is None
    assert sum(s["hours"] for s in r["sectors"]) == r["n_hours"]


def _write_table(path: Path, value: float) -> None:
    rows = [f"{d:02d}/01/{y},{','.join([str(value)] * 24)}" for y in rose.YEARS for d in range(1, 13)]
    path.write_text("<html><pre>\n" + "\n".join(rows) + "\n</pre></html>")


def test_site_without_wind_is_skipped_not_drawn(tmp_path):
    for y in rose.YEARS:
        for site in ("48_201_9001", "48_201_9002"):
            for param in rose.COMPOUNDS:
                _write_table(tmp_path / f"agc_{y}_{site}_{param}.html", 1.0)
        _write_table(tmp_path / f"met_{y}_48_201_9001_61102.html", 100.0)
        _write_table(tmp_path / f"met_{y}_48_201_9001_61101.html", 6.0)
    out = rose.run(raw=tmp_path, sites={"48_201_9001": "Has wind", "48_201_9002": "No wind"})
    assert list(out["sites"]) == ["48_201_9001"]
    assert [s["site_id"] for s in out["skipped_sites"]] == ["48_201_9002"]
    assert "no wind" in out["skipped_sites"][0]["reason"]


def test_milby_park_benzene_real_data():
    c = rose.site_rose("48_201_0069")["compounds"]["45201"]
    assert c["n_hours"] == 10913 and c["thresholds_ppb"]["p99"] == 1.939
    h = c["headline"]
    assert (h["from_deg"], h["to_deg"], h["high_hours"]) == (30, 60, 70)
    assert c["high_hours"]["p99"] == 110 and h["share_of_hours"] == 0.0772


def test_published_rose_is_current():
    assert json.loads(rose.OUT.read_text()) == rose.run(), "rerun: uv run python -m pipeline.rose"


def test_headline_is_none_when_every_sector_is_sparse():
    pairs = [(float(i), 45.0, "01/01/2024") for i in range(rose.MIN_SECTOR_HOURS - 1)]
    assert rose.headline(rose.cpf(pairs)) is None
