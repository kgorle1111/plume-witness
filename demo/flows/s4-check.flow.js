const { hold, ready, next, glide, zoomMap } = require('./flow-lib.js');

// Shot 4 (0:42-1:05): tap "Next: Check"; the "reported" status and both checks (T+24h, T+14d), then
// "What the report says" (7,634 lb, 9:38-10:42) and "Other reports filed that day (2)".
module.exports = async (page) => {
  await ready(page);
  await next(page, 'Check');
  await hold(page, 3200); // the status, the search scope and the checks over time
  await glide(page.locator('h3.list-heading').filter({ hasText: 'Checks over time' }), page, 1200);
  await hold(page, 2400);
  await glide(page.locator('h3.list-heading').filter({ hasText: 'What the report says' }), page, 1400);
  await hold(page, 1400); // 7,634 lb, 09:38-10:42 local
  await zoomMap(page, 522, 481, 2, -120); // keeps the hold under 3 s (craftlint STATIC-HOLD); the panel stays put
  await hold(page, 600);
  await glide(page.locator('h3.list-heading').filter({ hasText: 'Other reports filed that day' }), page, 1400);
  await hold(page, 1800);
  // The panel is at its end here, so the motion comes from the map: close in on the facility that filed.
  await zoomMap(page, 522, 481, 4, -200);
  await hold(page, 1800);
  await zoomMap(page, 522, 481, 4, 200);
  await hold(page, 1500);
};
