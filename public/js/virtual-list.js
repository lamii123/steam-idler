const BUFFER = 5;
const MAX_CACHED_ROWS = 200;

export class VirtualList {
  constructor(container, itemHeight, renderItem, onRender = null) {
    this.container = container;
    this.itemHeight = itemHeight;
    this.renderItem = renderItem;
    this.onRender = onRender;
    this.items = [];
    this.rafId = null;
    this._cache = new Map();

    this.container.style.overflowY = 'auto';

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'vl-wrapper';
    this.wrapper.style.position = 'relative';
    this.container.appendChild(this.wrapper);

    this._onScroll = this._onScroll.bind(this);
    this.container.addEventListener('scroll', this._onScroll, { passive: true });
  }

  setItems(items) {
    this.items = Array.isArray(items) ? items : [];
    this._cache.clear();
    this.container.scrollTop = 0;
    this._update();
  }

  _update() {
    this.wrapper.style.height = `${this.items.length * this.itemHeight}px`;
    this._render();
  }

  _onScroll() {
    if (this.rafId) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this._render();
    });
  }

  _render() {
    if (this.items.length === 0) {
      this.wrapper.replaceChildren();
      return;
    }

    const scrollTop = this.container.scrollTop;
    const viewportHeight = this.container.clientHeight;

    let start = Math.floor(scrollTop / this.itemHeight) - BUFFER;
    start = Math.max(0, start);

    let end = Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + BUFFER;
    end = Math.min(this.items.length, end);

    const fragment = document.createDocumentFragment();

    for (let index = start; index < end; index += 1) {
      const item = this.items[index];
      let element = this._cache.get(item.appId);

      if (element) {
        // Refresh insertion order so the rows closest to the viewport survive
        // eviction on long scrolls.
        this._cache.delete(item.appId);
      } else {
        element = this.renderItem(item, index);
      }

      this._cache.set(item.appId, element);

      while (this._cache.size > MAX_CACHED_ROWS) {
        const oldestKey = this._cache.keys().next().value;
        this._cache.delete(oldestKey);
      }

      element.style.position = 'absolute';
      element.style.top = `${index * this.itemHeight}px`;
      element.style.left = '0';
      element.style.right = '0';
      element.style.height = `${this.itemHeight}px`;
      element.setAttribute('aria-posinset', String(index + 1));
      element.setAttribute('aria-setsize', String(this.items.length));

      fragment.appendChild(element);
    }

    this.wrapper.replaceChildren(fragment);

    if (this.onRender) this.onRender();
  }
}
