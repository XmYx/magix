// windowModal.js — reusable draggable, resizable, closeable modal window
export class WindowModal {
  constructor({ id, title = '', content = '', width = 300, height = 200 }) {
    this.id = id;
    this.title = title;
    this.content = content;
    this.width = width;
    this.height = height;
    this._createElement();
    this._attachEvents();
  }

  _createElement() {
    // Container
    this.el = document.createElement('div');
    this.el.id = this.id;
    this.el.className = 'retro-window';
    this.el.style.width = this.width + 'px';
    this.el.style.height = this.height + 'px';
    this.el.style.display = 'none';

    // Title bar
    this.titleBar = document.createElement('div');
    this.titleBar.className = 'title-bar';
    this.titleBar.innerHTML = `
      <span class="title-text">${this.title}</span>
      <span class="close" data-action="close">✕</span>
    `;
    this.el.appendChild(this.titleBar);

    // Content area
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'content';
    this.contentEl.innerHTML = this.content;
    this.contentEl.style.overflow = 'auto'; // enable scrollbars
    this.el.appendChild(this.contentEl);

    // Resize handle
    this.resizeHandle = document.createElement('div');
    this.resizeHandle.className = 'resize-handle';
    this.el.appendChild(this.resizeHandle);

    document.body.appendChild(this.el);
  }

  _attachEvents() {
    // Close button
    this.titleBar.querySelector('[data-action="close"]').addEventListener('click', () => this.close());

    // Dragging
    let offsetX, offsetY;
    this.titleBar.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = this.el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      const onMouseMove = moveEvent => {
        this.el.style.left = moveEvent.clientX - offsetX + 'px';
        this.el.style.top = moveEvent.clientY - offsetY + 'px';
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', onMouseMove);
      }, { once: true });
    });

    // Resizing
    let startW, startH, startX, startY;
    this.resizeHandle.addEventListener('mousedown', e => {
      e.preventDefault();
      const rect = this.el.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
      startX = e.clientX;
      startY = e.clientY;
      const onMouseMove = moveEvent => {
        const newW = startW + (moveEvent.clientX - startX);
        const newH = startH + (moveEvent.clientY - startY);
        this.el.style.width = newW + 'px';
        this.el.style.height = newH + 'px';
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', () => {
        document.removeEventListener('mousemove', onMouseMove);
      }, { once: true });
    });
  }

  open() {
    this.el.style.display = 'block';
  }

  close() {
    this.el.style.display = 'none';
  }
}
