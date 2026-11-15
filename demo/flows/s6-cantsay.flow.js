const { hold, ready, tab, glide, zoomMap, glideWindow } = require('./flow-lib.js');

// Shot 6 (1:22-1:45): first the method brief's "In three sentences" (capture.sh opens ?view=brief), where the
// narration's "52 of 72" and "ordinary days spiked just as often" are printed; then the replay, where "What this
// can't say" opens at the top of the panel and stays open on every step.
// Map zooms between steps keep holds under 3 s (craftlint STATIC-HOLD); the panel text never moves while held.
module.exports = async (page) => {
  const three = page.getByRole('heading', { level: 2, name: 'In three sentences' });
  await three.waitFor({ timeout: 15000 });
  await hold(page, 2000); // the brief's title
  await glideWindow(three, page, 1200);
  await hold(page, 2400); // 1. In 52 of 72 company-reported releases ... downwind
  await glideWindow(page.locator('.br-doc > ol').first(), page, 1200); // a short move: all three stay in view
  await hold(page, 2800); // 2. ... ordinary days at the same monitors and hours spiked in 19 of 386 windows
  // The brief's "Back to the event replay" link opens the landing page since PR #50, so go to the replay directly.
  await page.goto(new URL('?intro=0#detect', page.url()).toString(), { timeout: 30000 });
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
