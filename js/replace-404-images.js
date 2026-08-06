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

  // Resolve a (possibly relative) URL the same way the browser would
  function resolveUrl(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch (e) {
      return url;
    }
  }

  // Remove only the candidate matching failedUrl from el's srcset list,
  // preserving any other still-valid candidates (e.g. other widths/
  // densities). Falls back to clearing the whole srcset/sizes when no
  // candidates remain. Returns true if a matching candidate was found.
  function removeFailedCandidate(el, failedUrl) {
    const srcset = el.getAttribute('srcset');
    if (!srcset) {
      return false;
    }

    const candidates = srcset.split(',').map(function(entry) {
      return entry.trim();
    }).filter(Boolean);

    const remaining = candidates.filter(function(entry) {
      const url = entry.split(/\s+/)[0];
      return resolveUrl(url) !== failedUrl;
    });

    if (remaining.length === candidates.length) {
      return false; // failedUrl isn't one of this element's candidates
    }

    if (remaining.length > 0) {
      el.setAttribute('srcset', remaining.join(', '));
    } else {
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
    }
    return true;
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

      // srcset/sizes take priority over src, so a still-eligible candidate
      // must be cleared first or the browser keeps resolving it instead of
      // the new src. Try to remove only the failed candidate; if it can't
      // be located in the img's own srcset (e.g. it came from a <picture>
      // source, or `src` was used as-is), fall back to clearing outright.
      if (!removeFailedCandidate(img, failedSrc)) {
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      }

      // Inside a <picture>, a <source srcset> takes priority over the
      // fallback <img> entirely. Locate the specific source -- and
      // specific candidate within it -- that actually served failedSrc,
      // by matching the resolved URL rather than re-simulating the
      // browser's media/type selection (which can't reliably detect type
      // support). This leaves unrelated sources, and other still-valid
      // candidates in the same source, untouched.
      const picture = img.closest('picture');
      if (picture) {
        const sources = picture.querySelectorAll('source');
        for (let i = 0; i < sources.length; i++) {
          if (removeFailedCandidate(sources[i], failedSrc)) {
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
