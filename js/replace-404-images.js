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

  // Parse a srcset attribute into {url, raw} candidates, loosely
  // following the WHATWG "parse a srcset attribute" algorithm: a
  // candidate's URL is read as a run of non-whitespace characters (so
  // an unescaped comma with no surrounding whitespace, e.g.
  // "missing,small.jpg", stays part of the URL), and candidates are
  // separated by a comma found while scanning the descriptor that
  // follows the URL (so "a.jpg 1x,b.jpg 2x" splits correctly even
  // without a space after the comma). Descriptors containing
  // parentheses (e.g. a future `calc()`) are tolerated by not treating
  // a comma inside them as a separator.
  function parseSrcsetCandidates(srcset) {
    const candidates = [];
    const len = srcset.length;
    let pos = 0;

    function isWhitespace(ch) {
      return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
    }

    while (pos < len) {
      while (pos < len && (isWhitespace(srcset[pos]) || srcset[pos] === ',')) {
        pos++;
      }
      if (pos >= len) {
        break;
      }

      const urlStart = pos;
      while (pos < len && !isWhitespace(srcset[pos])) {
        pos++;
      }
      let url = srcset.slice(urlStart, pos);

      if (url.charAt(url.length - 1) === ',') {
        url = url.replace(/,+$/, '');
        candidates.push({ url: url, raw: url });
        continue; // the trailing comma(s) already act as the separator
      }

      while (pos < len && isWhitespace(srcset[pos])) {
        pos++;
      }
      const descriptorStart = pos;
      let parens = 0;
      while (pos < len) {
        const ch = srcset[pos];
        if (ch === '(') {
          parens++;
        } else if (ch === ')') {
          parens = Math.max(0, parens - 1);
        } else if (ch === ',' && parens === 0) {
          break;
        }
        pos++;
      }
      const descriptor = srcset.slice(descriptorStart, pos).trim();
      candidates.push({ url: url, raw: descriptor ? url + ' ' + descriptor : url });

      if (pos < len && srcset[pos] === ',') {
        pos++; // consume the separator
      }
    }

    return candidates;
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

    const candidates = parseSrcsetCandidates(srcset);
    const remaining = candidates.filter(function(candidate) {
      return resolveUrl(candidate.url) !== failedUrl;
    });

    if (remaining.length === candidates.length) {
      return false; // failedUrl isn't one of this element's candidates
    }

    if (remaining.length > 0) {
      el.setAttribute('srcset', remaining.map(function(candidate) {
        return candidate.raw;
      }).join(', '));
    } else {
      el.removeAttribute('srcset');
      el.removeAttribute('sizes');
    }
    return true;
  }

  // Whether el (an img or source) still has responsive candidates that
  // could be selected in place of the placeholder we just assigned
  function hasCandidates(el) {
    return el.hasAttribute('srcset');
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

      if (failedSrc.startsWith(PLACEHOLDER_BASE)) {
        // The placeholder itself failed (e.g. blocked by CSP, or the
        // network is down). There's nothing left to substitute, so stop
        // listening instead of reassigning the same blocked URL again
        // and overwriting data-original-src with it.
        img.onerror = null;
        return;
      }

      console.warn('[404 Image Replacement] Failed to load image:', failedSrc);
      img.setAttribute('data-original-src', failedSrc);

      const picture = img.closest('picture');

      // srcset/sizes take priority over src, so a still-eligible candidate
      // must be cleared first or the browser keeps resolving it instead of
      // the new src. Try to remove only the failed candidate. If it can't
      // be located in the img's own srcset, that's expected whenever the
      // failure actually came from a <picture> source instead (handled
      // below) -- the img's own srcset is unrelated and must be left
      // alone. Only for a bare <img> (no <picture> ancestor) do we fall
      // back to clearing outright, since there `src` being used as-is
      // still means srcset must be neutralised or it can win again.
      const imgHadMatch = removeFailedCandidate(img, failedSrc);
      if (!imgHadMatch && !picture) {
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
      }

      // Inside a <picture>, a <source srcset> takes priority over the
      // fallback <img> entirely. Locate the specific candidate(s) that
      // actually served failedSrc by matching the resolved URL rather
      // than re-simulating the browser's media/type selection (which
      // can't reliably detect type support). Every source is checked --
      // not just the first match -- since more than one source can list
      // the same URL (e.g. across breakpoints); stopping early would
      // leave a still-eligible source free to override the placeholder
      // later (say, after a viewport/DPR change re-selects it).
      if (picture) {
        picture.querySelectorAll('source').forEach(function(source) {
          removeFailedCandidate(source, failedSrc);
        });
      }

      img.src = getPlaceholderImage(failedSrc);

      // Keep listening for errors as long as some other candidate could
      // still be selected instead of the placeholder (a retained,
      // possibly-also-broken srcset entry on the img or on a <picture>
      // source) -- only stop once the placeholder is the sole remaining
      // candidate, so a later failure can only be the placeholder itself.
      const stillHasCandidates = hasCandidates(img) ||
        (picture && Array.prototype.some.call(picture.querySelectorAll('source'), hasCandidates));
      if (!stillHasCandidates) {
        img.onerror = null; // Prevent an unreachable placeholder from looping
      }
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
