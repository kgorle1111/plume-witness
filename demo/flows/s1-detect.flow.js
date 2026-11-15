const { hold, ready, zoomMap, flaggedPoint } = require('./flow-lib.js');

// Shot 1 (0:00-0:12): the header, the reading and the Milby Park sparkline with its 9:00 bar, all in the first view.
// The panel holds still; the motion is real map zooms on the monitor, so the shot does not open on a still page.
module.exports = async (page) => {
  await ready(page);
  const [mx, my] = await flaggedPoint(page); // Milby Park, at any capture size
  await zoomMap(page, mx, my, 3, -140, { exact: true }); // close in on the Milby Park monitor
  await hold(page, 2000);
  await zoomMap(page, mx, my, 2, -100, { exact: true });
  await hold(page, 2200);
  await zoomMap(page, mx, my, 3, 140, { exact: true });
  await hold(page, 2200);
  await zoomMap(page, mx, my, 2, 100, { exact: true });
  await hold(page, 2000);
};
