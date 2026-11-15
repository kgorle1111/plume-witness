const { hold, waitForFlat } = require('./flow-lib.js');

// Opening shot: the globe intro (globe -> flying -> flat). The intro plays on load only at 1024px and wider and
// without reduced motion or ?intro=0. capture.sh records at 1280x720, which qualifies; resizing to 1440 here would
// make the page larger than the recorded frame, so the flow keeps capture's viewport.
module.exports = async (page) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const url = new URL(page.url());
  url.searchParams.delete('intro');
  url.searchParams.set('view', 'replay');
  // A fresh load so the take starts at the very beginning of the intro, whatever the first load already did.
  await page.goto(url.toString(), { timeout: 30000 });
  const phase = page.locator('.map-canvas');
  await page.locator('.map-canvas[data-phase="globe"]').waitFor({ timeout: 15000 });
  await page.locator('.intro-pin').waitFor({ timeout: 15000 }); // the Houston marker is on the globe
  await page.locator('.map-canvas[data-phase="flying"]').waitFor({ timeout: 10000 });
  await waitForFlat(page, 10000);
  await hold(page, 2500); // lands on the flat replay: the spike hour, the corridor, the flagged monitor
  if ((await phase.getAttribute('data-phase')) !== 'flat') throw new Error('globe intro did not end on the flat replay');
};
