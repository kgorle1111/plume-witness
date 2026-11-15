const { hold, ready, next, glide } = require('./flow-lib.js');

// Shot 3 (0:27-0:42): tap "Next: Trace"; the wedge draws and "In the upwind corridor (47)" fills in.
module.exports = async (page) => {
  await ready(page);
  await next(page, 'Trace');
  const heading = page.getByRole('heading', { name: /^In the upwind corridor \(\d+\)$/ });
  await heading.waitFor({ timeout: 10000 });
  await hold(page, 1600); // the wind line and the caveat
  await glide(heading, page, 1400);
  const rows = page.locator('ol.facility-list > li');
  for (let i = 0; i < 3; i++) {
    await rows.nth(i).hover(); // names the facility on the map, nearest first
    await hold(page, 1500);
  }
  await page.mouse.move(640, 700);
  await hold(page, 2400);
};
