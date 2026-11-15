const { hold, ready, glide, zoomMap } = require('./flow-lib.js');

module.exports = async (page) => {
  await ready(page);
  await zoomMap(page, 260, 540, 4, -240); // opens on motion: close in on the Milby Park monitor
  await hold(page, 2000); // the reading, the baseline and the rule
  await glide(page.locator('figure.spark'), page);
  await hold(page, 1500); // the 24-hour bars with the 9 a.m. peak
  await page.getByText('Show all 24 hourly values').click();
  await hold(page, 800);
  await glide(page.locator('.hourly-table tbody tr').nth(7), page);
  await hold(page, 1800); // the 09:00 row in the table
  await zoomMap(page, 260, 540, 4, 240); // back out to the whole corridor before the Trace shot
  await glide(page.locator('dl.facts'), page); // back up to the reading: ends on 51.75 ppb-v and the baseline
  await hold(page, 1800);
};
