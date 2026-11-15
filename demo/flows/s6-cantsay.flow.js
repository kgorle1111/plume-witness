const { hold, ready, tab, glide, zoomMap } = require('./flow-lib.js');

// Shot 6 (1:22-1:45): open "What this can't say" at the top of the panel; it stays open on every step.
// Map zooms between steps keep holds under 3 s (craftlint STATIC-HOLD); the panel text never moves while held.
module.exports = async (page) => {
  await ready(page);
  const limits = page.locator('details.cannot-say');
  await limits.locator('summary').click();
  await hold(page, 2200);
  await zoomMap(page, 300, 420, 3, -120);
  await hold(page, 1200);
  for (const name of ['Trace', 'Check', 'Packet']) {
    await tab(page, name);
    await glide(limits, page, 500);
    await hold(page, 1600); // same limits, a different step
    await zoomMap(page, 300, 420, 1, name === 'Check' ? 240 : -120);
  }
  await hold(page, 1500);
  if (!(await limits.evaluate((el) => el.open))) throw new Error("the can't-say panel closed on a step change");
};
