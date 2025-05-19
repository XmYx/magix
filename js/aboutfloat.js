// aboutFloat.js — specialized About window using WindowModal
import { WindowModal } from './windowmodal.js';

export class AboutFloat extends WindowModal {
  constructor(options = {}) {
    super(Object.assign({
      id: 'aboutFloat',
      title: 'About This App',
      content: AboutFloat.defaultContent(),
      width: 280,
      height: 180
    }, options));
  }

  static defaultContent() {
    return `
      <p>This is a demo of a retro macOS‐style menu bar.</p>
      <p>Version 1.0.0</p>
    `;
  }
}