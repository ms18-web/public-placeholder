(function() {
  'use strict';

  // Base URL for placeholder images
  const PLACEHOLDER_BASE = 'https://ms18-web.github.io/public-placeholder/';

  // Get appropriate placeholder image based on original src extension
  function getPlaceholderImage(src) {
    if (src && src.toLowerCase().endsWith('.png')) {
      return PLACEHOLDER_BASE + 'dummy.png';
    }
    return PLACEHOLDER_BASE + 'dummy.jpg';
  }

  // Check whether an image is 404 and replace it
  function checkAndReplaceImage(img) {
    // Skip if it is already a placeholder
    if (img.src.startsWith(PLACEHOLDER_BASE)) {
      return;
    }

    // Swap the failed image (and any srcset/<picture> candidates) for a placeholder
    function replaceWithPlaceholder() {
      // currentSrc reflects the candidate the browser actually attempted
      // (covers plain src, srcset candidates, and <picture> sources).
      // img.src is only a fallback for the rare case currentSrc is unset.
      const failedSrc = img.currentSrc || img.src;
      console.warn('[404 Image Replacement] Failed to load image:', failedSrc);
      img.setAttribute('data-original-src', failedSrc);

      // srcset/sizes take priority over src, so they must be cleared first
      // or the browser keeps resolving the (still-broken) srcset candidates
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');

      // Inside a <picture>, a <source srcset> takes priority over the
      // fallback <img> entirely, so it must be disabled too. Only the
      // source the browser would currently pick is disabled -- other
      // sources gated by a non-matching `media` may still be valid
      // (e.g. a broken mobile source must not also break the desktop one).
      const picture = img.closest('picture');
      if (picture) {
        const sources = picture.querySelectorAll('source');
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i];
          if (!source.media || window.matchMedia(source.media).matches) {
            source.removeAttribute('srcset');
            source.removeAttribute('sizes');
            break;
          }
        }
      }

      img.src = getPlaceholderImage(failedSrc);
      img.onerror = null; // Prevent an unreachable placeholder from looping
    }

    // Handle image load errors
    img.onerror = function() {
      replaceWithPlaceholder();
    };

    // Check images that have already failed to load
    if (img.complete && img.naturalWidth === 0) {
      replaceWithPlaceholder();
    }
  }

  // Check existing images on page load
  function checkExistingImages() {
    const images = document.querySelectorAll('img');
    images.forEach(checkAndReplaceImage);
  }

  // Observe newly added images
  function observeNewImages() {
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeName === 'IMG') {
            checkAndReplaceImage(node);
          } else if (node.querySelectorAll) {
            const images = node.querySelectorAll('img');
            images.forEach(checkAndReplaceImage);
          }
        });
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Run after DOM content is fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      checkExistingImages();
      observeNewImages();
    });
  } else {
    checkExistingImages();
    observeNewImages();
  }
})();
