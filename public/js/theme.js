import { safeSteamAssetUrl } from './steam-url.js';

let bgVideo = null;
let visibilityBound = false;

/**
 * Pause the decorative profile background when the tab is hidden.
 */
export function initTheme() {
  if (visibilityBound) return;
  visibilityBound = true;

  document.addEventListener('visibilitychange', () => {
    if (!bgVideo) return;

    if (document.hidden) {
      bgVideo.pause();
    } else {
      bgVideo.play().catch(() => {});
    }
  });
}

export function removeBgVideo() {
  if (bgVideo) {
    bgVideo.remove();
    bgVideo = null;
  }

  const root = document.documentElement;
  root.style.setProperty('--user-bg-image', 'none');
  root.removeAttribute('data-user-backdrop');
}

/**
 * Apply the signed-in user's Steam profile background. URLs are validated
 * before they reach CSS or a media element.
 */
export function applyUserTheme(profile) {
  const root = document.documentElement;
  removeBgVideo();

  const backgroundUrl = safeSteamAssetUrl(profile.profileBackground?.url || '');

  if (!backgroundUrl) {
    return;
  }

  if (profile.profileBackground.animated) {
    // Respect the OS "reduce motion" setting: a looping full-screen video is
    // exactly the kind of motion this preference is meant to suppress.
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    root.style.setProperty('--user-bg-image', 'none');
    if (reduceMotion) return;

    root.setAttribute('data-user-backdrop', 'true');
    bgVideo = document.createElement('video');
    bgVideo.src = backgroundUrl;
    bgVideo.muted = true;
    bgVideo.autoplay = true;
    bgVideo.loop = true;
    bgVideo.playsInline = true;
    bgVideo.setAttribute('aria-hidden', 'true');
    bgVideo.disablePictureInPicture = true;

    Object.assign(bgVideo.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      objectFit: 'cover',
      opacity: '0.15',
      pointerEvents: 'none',
      zIndex: '-1',
    });

    document.body.prepend(bgVideo);
  } else {
    root.style.setProperty('--user-bg-image', `url("${backgroundUrl}")`);
    root.setAttribute('data-user-backdrop', 'true');
  }
}
