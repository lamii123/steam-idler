const LAYOUT_GAP = 16;
const MIN_COL_WIDTH = 260;

export function columnCount(containerWidth) {
  return Math.max(
    1,
    Math.floor((containerWidth + LAYOUT_GAP) / (MIN_COL_WIDTH + LAYOUT_GAP))
  );
}

/**
 * Lay out the grid as a lightweight masonry using absolute positioning.
 *
 * Widths are written first, then heights are read in one pass, then positions
 * are written. That keeps layout reads out of the per-card read/write loop.
 */
export function layoutCards(grid) {
  const cards = [...grid.children];

  if (!cards.length) {
    grid.style.height = '0px';
    return;
  }

  const containerWidth = grid.parentElement.clientWidth;
  const cols = columnCount(containerWidth);
  const colWidth = (containerWidth - LAYOUT_GAP * (cols - 1)) / cols;

  cards.forEach((card) => {
    card.style.position = 'absolute';
    card.style.width = `${colWidth}px`;
  });

  const heights = cards.map((card) => card.offsetHeight);
  const colHeights = new Array(cols).fill(0);

  cards.forEach((card, index) => {
    const shortestCol = colHeights.indexOf(Math.min(...colHeights));
    card.style.left = `${shortestCol * (colWidth + LAYOUT_GAP)}px`;
    card.style.top = `${colHeights[shortestCol]}px`;
    colHeights[shortestCol] += heights[index] + LAYOUT_GAP;
  });

  grid.style.height = `${Math.max(...colHeights)}px`;
}
