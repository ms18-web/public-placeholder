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
      // fallback <img> entirely, so its candidates must be disabled too
      const picture = img.closest('picture');
      if (picture) {
        picture.querySelectorAll('source').forEach(function(source) {
          source.removeAttribute('srcset');
          source.removeAttribute('sizes');
        });
      }

      img.src = getPlaceholderImage(failedSrc);
    }

    // Handle image load errors
    img.onerror = function() {
      replaceWithPlaceholder();
      img.onerror = null; // Prevent infinite loop
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
