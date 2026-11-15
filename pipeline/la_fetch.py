"""Fetch what the Los Angeles replay reads, one request at a time, into data/raw/region_los_angeles/ with provenance.

- wind: hourly ASOS observations (direction, speed) from the Iowa Environmental Mesonet for the airports near the
  Rule 1180 stations, in local standard time (Etc/GMT+8, PST all year, like the 1180 files)
- echo: EPA ECHO air facilities within 10 mi of each Rule 1180 station (the same query as Texas)

Usage: uv run python -m pipeline.la_fetch [wind] [echo]
"""

import json
import sys
import urllib.parse

from pipeline import fetch_backtest as fb
from pipeline import la1180

IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py"
# Airports with an ASOS inside 15 km of some Rule 1180 station; the 10 km borrow cap is applied when the wind is read.
# kn: Compton/Woodley (CPM) is also within 15 km of some stations, but the Mesonet returned no rows for it.
AIRPORTS = ("LGB", "TOA", "HHR", "LAX")
WIND_SPAN = ("2021-10-01", "2022-12-01")  # every LA spike day, with room for the day before and after


def wind() -> None:
    (y1, m1, d1), (y2, m2, d2) = (s.split("-") for s in WIND_SPAN)
    for st in AIRPORTS:
        name = f"asos_{st}_{y1}{m1}_{y2}{m2}.csv"
        if (fb.BT / name).exists():
            continue
        q = [("station", st), ("data", "drct"), ("data", "sknt"), ("year1", y1), ("month1", str(int(m1))),
             ("day1", str(int(d1))), ("year2", y2), ("month2", str(int(m2))), ("day2", str(int(d2))),
             ("tz", "Etc/GMT+8"), ("format", "onlycomma"), ("latlon", "yes"), ("missing", "M"),
             ("report_type", "3")]
        url = IEM + "?" + urllib.parse.urlencode(q)
        fb._save(name, url, None, fb._polite_get(url))
        fb.log(f"wind {st}")


def echo() -> None:
    for code, (_, lat, lon) in la1180.stations().items():
        name = f"echo_r1180_{code}_10mi.json"
        if (fb.BT / name).exists():
            continue
        q = {"output": "JSON", "p_lat": f"{lat:.4f}", "p_long": f"{lon:.4f}", "p_radius": "10", "p_act": "Y"}
        qid = json.loads(fb._polite_get(fb.ECHO_QUERY + "?" + urllib.parse.urlencode(q)))["Results"]["QueryID"]
        page = {"output": "JSON", "qid": qid, "pageno": "1"}
        content = fb._polite_get(fb.ECHO_PAGE + "?" + urllib.parse.urlencode(page))
        fb._save(name, fb.ECHO_PAGE, {**q, **page}, content)
        res = json.loads(content)["Results"]
        fb.log(f"echo {code}: {len(res.get('Facilities', []))} of {res.get('QueryRows')}")


if __name__ == "__main__":
    fb.use_dir(la1180.RAW, {})
    for phase in sys.argv[1:] or ["wind", "echo"]:
        {"wind": wind, "echo": echo}[phase]()
