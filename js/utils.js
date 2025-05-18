/* utils.js — shared helpers */
export const isTouchDevice = () =>
  'ontouchstart' in window ||
  navigator.maxTouchPoints > 0 ||
  navigator.msMaxTouchPoints > 0;

export const $ = sel => document.querySelector(sel);

export const YT_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|v\/))([\w-]{11})/i;

export const getYoutubeId = url => (url.match(YT_REGEX) || [])[1] || null;

export const ytThumb = id => `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
