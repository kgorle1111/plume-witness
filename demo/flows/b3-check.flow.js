const { hold, ready, tab, glide, zoomMap } = require('./flow-lib.js');

module.exports = async (page) => {
  await ready(page);
  await tab(page, 'Check');
  await hold(page, 2000); // status and the search scope
  await glide(page.locator('h3.list-heading').filter({ hasText: 'What the report says' }), page);
  await hold(page, 2000);
  await glide(page.locator('h3.list-heading').filter({ hasText: 'Other reports filed that day' }), page, 900);
  await hold(page, 500);
  // The panel is at its end here, so the motion comes from the map: close in on the facility that filed (#37).
  await zoomMap(page, 522, 481, 4, -240);
  await hold(page, 1500);
  await zoomMap(page, 522, 481, 4, 240);
  await hold(page, 500);
  // Back to the top for the limits: a matching report is not proof of cause.
  await glide(page.locator('details.cannot-say'), page, 1200);
  await page.locator('details.cannot-say > summary').click();
  await hold(page, 2800);
};
