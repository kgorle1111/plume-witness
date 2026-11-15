const { hold, ready, glide, zoomMap, flaggedPoint } = require('./flow-lib.js');

// Shot 2 (0:12-0:27): the reading (51.75 ppb-v) against its baseline (0.21), then the pollution rose below.
// The "slow zoom" is a real map zoom into the monitor while the panel holds the reading; nothing is scaled in post.
module.exports = async (page) => {
  await ready(page);
  const [mx, my] = await flaggedPoint(page); // Milby Park, at any capture size
  await zoomMap(page, mx, my, 8, -70, { exact: true }); // slow push-in on Milby Park while the reading and baseline hold
  await hold(page, 1800);
  await glide(page.locator('figure.rose'), page, 1600);
  await hold(page, 2600); // the rose for Milby Park
  await zoomMap(page, mx, my, 6, 90, { exact: true });
  await hold(page, 1600);
  await glide(page.locator('dl.facts'), page, 1400);
  await hold(page, 2000);
};
