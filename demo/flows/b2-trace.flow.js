const { hold, ready, tab, glide } = require('./flow-lib.js');

module.exports = async (page) => {
  await ready(page);
  await tab(page, 'Trace');
  await hold(page, 2000); // the wind line and the caveat
  const rows = page.locator('ol.facility-list > li');
  await rows.nth(0).hover();
  await hold(page, 1800); // nearest facility named on the map
  await rows.nth(1).hover();
  await hold(page, 1800);
  const matched = page.locator('ol.facility-list > li.is-matched');
  await glide(matched, page, 1200);
  await matched.focus(); // keyboard path; also highlights it on the map
  await matched.hover();
  await hold(page, 2000);
  await glide(rows.last(), page, 1200);
  await hold(page, 1200);
  await glide(matched, page, 1200);
  await hold(page, 1200);
};
