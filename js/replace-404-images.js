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

  // ---------------------------------------------------------------------
  // Detached images (new Image())
  //
  // Libraries such as vegas preload a slide with a detached `new Image()`
  // and only reveal the slide from its onload. When that URL is 404 the
  // load never fires and the slider stalls on a blank slide, even after
  // the slide's background-image has been swapped below. Patching the
  // `src` / `srcset` setters lets us redirect such a detached image to the
  // placeholder so its load (and the library's onload) still happens.
  // ---------------------------------------------------------------------

  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

  // Set src without going through our patched setter (used for our own
  // probes and for assigning the placeholder)
  function setNativeSrc(img, url) {
    srcDescriptor.set.call(img, url);
  }

  // Bumped on every src/srcset assignment, so we can tell whether someone
  // else's error handler already reassigned it (e.g. their own fallback)
  const srcVersions = new WeakMap();
  const watchedDetachedImages = new WeakSet();

  function watchDetachedImage(img) {
    if (watchedDetachedImages.has(img)) {
      return;
    }
    watchedDetachedImages.add(img);

    // Capture listeners on the target run before onerror/bubble listeners,
    // so the version and URL recorded here are the ones the error belongs to
    img.addEventListener('error', function() {
      const version = srcVersions.get(img);
      const srcAtError = img.src;
      const srcsetAtError = img.getAttribute('srcset');
      // currentSrc is the candidate actually requested (a srcset entry
      // wins over src)
      const failedSrc = img.currentSrc || img.src;

      // Wait for the whole dispatch to finish so other handlers get the
      // first chance to react to the error
      setTimeout(function() {
        // Another handler reassigned src/srcset: through the property
        // (version bumped, even to the same URL as a retry) or through
        // setAttribute (value changed). A handler that ran before this
        // listener (an earlier capture listener) isn't caught by those
        // snapshots, but its new request leaves the image loading or
        // loaded rather than broken. Or the image is now in the document
        // and handled by checkAndReplaceImage instead.
        if (srcVersions.get(img) !== version ||
            img.src !== srcAtError ||
            img.getAttribute('srcset') !== srcsetAtError ||
            !img.complete || img.naturalWidth > 0 ||
            img.isConnected) {
          return;
        }

        // Nothing to load, or the placeholder itself failed. data:/blob:
        // URLs can't be a 404; libraries load them on purpose to detect
        // image format support, and expect the error.
        if (!failedSrc || isPlaceholderUrl(failedSrc) ||
            failedSrc.startsWith('data:') || failedSrc.startsWith('blob:')) {
          return;
        }

        console.warn('[404 Image Replacement] Failed to load image:', failedSrc);
        img.setAttribute('data-original-src', failedSrc);
        // Still-eligible srcset candidates (the img's own, or a <source> of
        // a detached <picture>) would win over the placeholder
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        const picture = img.closest('picture');
        if (picture) {
          picture.querySelectorAll('source').forEach(function(source) {
            removeFailedCandidate(source, failedSrc);
          });
        }
        setNativeSrc(img, getPlaceholderImage(failedSrc));
      }, 0);
    }, true);
  }

  function patchImageSetter(name) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, name);
    if (!descriptor || !descriptor.set) {
      return;
    }
    try {
      Object.defineProperty(HTMLImageElement.prototype, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: descriptor.get,
        set: function(value) {
          srcVersions.set(this, (srcVersions.get(this) || 0) + 1);
          descriptor.set.call(this, value);
          if (!this.isConnected) {
            watchDetachedImage(this);
          }
        }
      });
    } catch (e) {
      // The prototype is frozen or the property non-configurable (hardened
      // environments, another library). Leave it unpatched so the rest of
      // the replacement still initializes.
    }
  }

  patchImageSetter('src');
  patchImageSetter('srcset');

  // ---------------------------------------------------------------------
  // CSS background images
  // ---------------------------------------------------------------------

  // Matches url(...) tokens in a computed background-image value. Browsers
  // serialize computed URLs as absolute, double-quoted strings, but single-
  // quoted and unquoted forms are accepted too.
  const URL_TOKEN = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^"')\s]*))\s*\)/g;

  const PSEUDO_ELEMENTS = ['::before', '::after'];

  // Resolved URL -> Promise<boolean> (true if the image loaded), so every
  // URL is requested at most once per page
  const backgroundProbes = new Map();

  // Rules overriding pseudo-element backgrounds: selector -> {rule, el}
  const pseudoRules = new Map();
  let pseudoStyleElement = null;
  let nextPseudoId = 1;
  const PSEUDO_ID_ATTR = 'data-placeholder-bg-id';

  // The marker id each element owns. The attribute alone can't be trusted:
  // cloneNode() copies it, and markup could contain it too.
  const pseudoIds = new WeakMap();

  // Always-true :not() clauses add ID-level specificity (2 IDs each), so the
  // override also beats an !important rule written with ID selectors
  // (e.g. `#hero::before { ... !important }`). Their argument requires two
  // different ids on one element, which can never match, so no page markup
  // can make them false.
  const PSEUDO_SPECIFICITY_BOOST = new Array(4).join(':not(#placeholder-bg-a#placeholder-bg-b)');

  // Unescape a CSS string (e.g. \" or \22 ) into its literal value
  function unescapeCss(value) {
    return value.replace(/\\([0-9a-fA-F]{1,6}[ \t\n\r\f]?|[\s\S])/g, function(match, escaped) {
      const hex = escaped.trim();
      if (/^[0-9a-fA-F]+$/.test(hex)) {
        const codePoint = parseInt(hex, 16);
        return codePoint === 0 || codePoint > 0x10FFFF ? '\uFFFD' : String.fromCodePoint(codePoint);
      }
      return escaped;
    });
  }

  // Resolve the URL captured by one URL_TOKEN match
  function urlFromToken(doubleQuoted, singleQuoted, unquoted) {
    const raw = doubleQuoted !== undefined ? doubleQuoted :
      singleQuoted !== undefined ? singleQuoted : unquoted;
    return resolveUrl(unescapeCss(raw));
  }

  // List the URLs a background-image value references
  function extractBackgroundUrls(value) {
    const urls = [];
    value.replace(URL_TOKEN, function(token, doubleQuoted, singleQuoted, unquoted) {
      urls.push(urlFromToken(doubleQuoted, singleQuoted, unquoted));
      return token;
    });
    return urls;
  }

  // Whether url is one of the placeholder images themselves. Only the exact
  // files count: other URLs under PLACEHOLDER_BASE are ordinary assets.
  function isPlaceholderUrl(url) {
    return url === PLACEHOLDER_BASE + 'dummy.jpg' || url === PLACEHOLDER_BASE + 'dummy.png';
  }

  // Whether a URL is worth checking (skip inline data and our placeholders)
  function isCheckableUrl(url) {
    return Boolean(url) &&
      !isPlaceholderUrl(url) &&
      !url.startsWith('data:') &&
      !url.startsWith('blob:');
  }

  // Load url in a detached image and report whether it succeeded
  function probeImage(url) {
    let probe = backgroundProbes.get(url);
    if (!probe) {
      probe = new Promise(function(resolve) {
        const img = new Image();
        img.onload = function() {
          resolve(true);
        };
        img.onerror = function() {
          resolve(false);
        };
        setNativeSrc(img, url); // bypass the detached-image redirect above
      });
      backgroundProbes.set(url, probe);
    }
    return probe;
  }

  // Replace only the url(...) tokens that failed, keeping every other
  // layer (gradients, image-set() siblings, working images) intact
  function replaceFailedUrls(value, failedUrls) {
    return value.replace(URL_TOKEN, function(token, doubleQuoted, singleQuoted, unquoted) {
      const url = urlFromToken(doubleQuoted, singleQuoted, unquoted);
      if (failedUrls.indexOf(url) === -1) {
        return token;
      }
      return 'url("' + getPlaceholderImage(url) + '")';
    });
  }

  function readBackground(el, pseudo) {
    const style = getComputedStyle(el, pseudo);
    if (pseudo) {
      // A pseudo-element without content isn't rendered
      const content = style.content;
      if (!content || content === 'none' || content === 'normal') {
        return null;
      }
    }
    const value = style.backgroundImage;
    if (!value || value === 'none' || value.indexOf('url(') === -1) {
      return null;
    }
    return value;
  }

  // Whether any of failedUrls is still part of a background-image value
  function stillShowsFailedUrl(value, failedUrls) {
    return extractBackgroundUrls(value).some(function(url) {
      return failedUrls.indexOf(url) !== -1;
    });
  }

  // Override the element's own background-image inline
  function applyElementBackground(entry) {
    entry.el.setAttribute('data-original-bg', entry.value);
    entry.el.style.setProperty('background-image', entry.replaced);
  }

  // An !important declaration in a stylesheet still beats a normal
  // inline one, so retry with !important if the failed URL survived
  function verifyElementBackground(entry) {
    if (stillShowsFailedUrl(getComputedStyle(entry.el).backgroundImage, entry.failedUrls)) {
      entry.el.style.setProperty('background-image', entry.replaced, 'important');
    }
  }

  // Pseudo-elements can't be styled inline, so tag the element and inject
  // a matching !important rule instead
  function applyPseudoBackground(entry) {
    const el = entry.el;
    let id = pseudoIds.get(el);
    if (!id) {
      id = String(nextPseudoId++);
      pseudoIds.set(el, id);
    }
    el.setAttribute(PSEUDO_ID_ATTR, id);
    el.setAttribute('data-original-bg-' + entry.pseudo.slice(2), entry.value);

    // Add or update a single rule through the CSSOM rather than rebuilding
    // the whole stylesheet text, which would get quadratic on pages with
    // many failed pseudo-element backgrounds
    const sheet = ensurePseudoSheet();
    const selector = '[' + PSEUDO_ID_ATTR + '="' + id + '"]' + PSEUDO_SPECIFICITY_BOOST + entry.pseudo;
    let owned = pseudoRules.get(selector);
    if (!owned) {
      try {
        owned = { rule: sheet.cssRules[sheet.insertRule(selector + ' {}', sheet.cssRules.length)], el: el };
      } catch (e) {
        return;
      }
      pseudoRules.set(selector, owned);
    }
    owned.rule.style.setProperty('background-image', entry.replaced, 'important');
  }

  // The <style> holding the pseudo-element overrides. A head manager or SPA
  // navigation may remove it, and its rules go with it, so recreate it and
  // re-insert every rule still in use.
  function ensurePseudoSheet() {
    if (pseudoStyleElement && pseudoStyleElement.isConnected) {
      return pseudoStyleElement.sheet;
    }
    pseudoStyleElement = document.createElement('style');
    pseudoStyleElement.setAttribute('data-placeholder-bg', '');
    document.head.appendChild(pseudoStyleElement);

    const sheet = pseudoStyleElement.sheet;
    pseudoRules.forEach(function(owned, selector) {
      try {
        owned.rule = sheet.cssRules[sheet.insertRule(selector + ' { ' + owned.rule.style.cssText + ' }', sheet.cssRules.length)];
      } catch (e) {
        pseudoRules.delete(selector);
      }
    });
    return sheet;
  }

  // Drop a marker this element doesn't own (copied by cloneNode() or
  // written in the markup), so it stops matching another element's rule
  // and gets checked on its own
  function releaseForeignPseudoMarker(el) {
    const marker = el.getAttribute(PSEUDO_ID_ATTR);
    if (marker !== null && pseudoIds.get(el) !== marker) {
      el.removeAttribute(PSEUDO_ID_ATTR);
      PSEUDO_ELEMENTS.forEach(function(pseudo) {
        el.removeAttribute('data-original-bg-' + pseudo.slice(2));
      });
    }
  }

  // Delete the rules of elements that have left the document, so pages that
  // keep creating and removing elements don't accumulate rules. An element
  // that comes back is re-checked as an added node and gets its rule again.
  let pseudoSweepScheduled = false;

  function sweepDetachedPseudoRules() {
    pseudoSweepScheduled = false;
    const sheet = pseudoStyleElement && pseudoStyleElement.sheet;
    pseudoRules.forEach(function(owned, selector) {
      if (owned.el.isConnected) {
        return;
      }
      const index = sheet ? Array.prototype.indexOf.call(sheet.cssRules, owned.rule) : -1;
      if (index !== -1) {
        sheet.deleteRule(index);
      }
      pseudoRules.delete(selector);
    });
    // Our own <style> may have been removed along with other nodes
    if (pseudoRules.size > 0) {
      ensurePseudoSheet();
    }
  }

  function queuePseudoSweep() {
    if (pseudoRules.size === 0 || pseudoSweepScheduled) {
      return;
    }
    pseudoSweepScheduled = true;
    // Wait a frame so an element that is only being moved is back in place
    requestAnimationFrame(sweepDetachedPseudoRules);
  }

  function verifyPseudoBackground(entry) {
    if (stillShowsFailedUrl(getComputedStyle(entry.el, entry.pseudo).backgroundImage, entry.failedUrls)) {
      console.warn('[404 Image Replacement] Could not override background image of', entry.el, entry.pseudo);
    }
  }

  // Replacements waiting to be applied, flushed once per frame. All reads
  // happen before all writes (and the verification reads after them), so a
  // burst of failures costs a couple of style recalculations instead of
  // one per element.
  let pendingReplacements = [];
  let replacementFlushScheduled = false;

  function flushReplacements() {
    replacementFlushScheduled = false;
    const entries = pendingReplacements;
    pendingReplacements = [];

    // The background may have changed while probing (e.g. a slider
    // moved on); that change is checked separately, so don't clobber it
    const current = entries.filter(function(entry) {
      return entry.el.isConnected && readBackground(entry.el, entry.pseudo) === entry.value;
    });

    current.forEach(function(entry) {
      entry.failedUrls.forEach(function(url) {
        console.warn('[404 Image Replacement] Failed to load background image:', url);
      });
      entry.replaced = replaceFailedUrls(entry.value, entry.failedUrls);
      if (entry.pseudo) {
        applyPseudoBackground(entry);
      } else {
        applyElementBackground(entry);
      }
    });

    current.forEach(function(entry) {
      if (entry.pseudo) {
        verifyPseudoBackground(entry);
      } else {
        verifyElementBackground(entry);
      }
    });
  }

  function queueReplacement(entry) {
    pendingReplacements.push(entry);
    if (!replacementFlushScheduled) {
      replacementFlushScheduled = true;
      requestAnimationFrame(flushReplacements);
    }
  }

  // Check one background layer stack (the element's own or a pseudo's)
  function checkBackground(el, pseudo) {
    const value = readBackground(el, pseudo);
    if (!value) {
      return;
    }

    const urls = extractBackgroundUrls(value).filter(function(url, i, all) {
      return isCheckableUrl(url) && all.indexOf(url) === i;
    });
    if (urls.length === 0) {
      return;
    }

    Promise.all(urls.map(probeImage)).then(function(results) {
      const failedUrls = urls.filter(function(url, i) {
        return !results[i];
      });
      if (failedUrls.length > 0) {
        queueReplacement({ el: el, pseudo: pseudo, value: value, failedUrls: failedUrls });
      }
    });
  }

  function checkAndReplaceBackground(el) {
    releaseForeignPseudoMarker(el);
    checkBackground(el, null);
    PSEUDO_ELEMENTS.forEach(function(pseudo) {
      checkBackground(el, pseudo);
    });
  }

  // Check every element in the document (html and body included)
  function checkExistingBackgrounds() {
    Array.prototype.forEach.call(document.querySelectorAll('html, body, body *'), checkAndReplaceBackground);
  }

  // Elements waiting for a background check, flushed once per frame so a
  // burst of mutations (e.g. a slider transition) is handled together
  const pendingBackgroundChecks = new Set();
  let backgroundFlushScheduled = false;

  function queueBackgroundCheck(el) {
    pendingBackgroundChecks.add(el);
    if (backgroundFlushScheduled) {
      return;
    }
    backgroundFlushScheduled = true;
    requestAnimationFrame(function() {
      backgroundFlushScheduled = false;
      const elements = Array.from(pendingBackgroundChecks);
      pendingBackgroundChecks.clear();
      elements.forEach(checkAndReplaceBackground);
    });
  }

  // A stylesheet added later (lazy-loaded bundles, CSS-in-JS) can change the
  // backgrounds of elements that already exist, so rescan the whole
  // document, coalescing bursts of additions
  let fullRescanTimer = null;

  function queueFullRescan() {
    if (fullRescanTimer !== null) {
      return;
    }
    fullRescanTimer = setTimeout(function() {
      fullRescanTimer = null;
      checkExistingBackgrounds();
    }, 100);
  }

  function isStylesheetNode(node) {
    return node.nodeName === 'STYLE' ||
      (node.nodeName === 'LINK' && /(^|\s)stylesheet(\s|$)/i.test(node.rel));
  }

  function handleAddedStylesheet(node) {
    if (node === pseudoStyleElement) {
      return; // our own overrides
    }
    if (node.nodeName === 'LINK') {
      node.addEventListener('load', queueFullRescan);
    } else {
      queueFullRescan();
    }
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  // Check existing images on page load
  function checkExistingImages() {
    const images = document.querySelectorAll('img');
    images.forEach(checkAndReplaceImage);
  }

  // Observe newly added images, elements and stylesheets, and style/class
  // changes that can swap a background (e.g. a slider writing a new inline
  // style)
  function observeChanges() {
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes') {
          if (mutation.attributeName === 'rel' || mutation.attributeName === 'href') {
            // A <link> started or stopped being a stylesheet (e.g. <link
            // rel="preload" as="style" onload="this.rel='stylesheet'">), or
            // a stylesheet switched to another file (theme switchers). Either
            // way existing elements may get different backgrounds.
            if (mutation.target.nodeName === 'LINK') {
              if (isStylesheetNode(mutation.target)) {
                handleAddedStylesheet(mutation.target);
              }
              queueFullRescan();
            }
            return;
          }
          queueBackgroundCheck(mutation.target);
          return;
        }

        // The text of an existing <style> was replaced
        if (mutation.target.nodeName === 'STYLE' && mutation.target !== pseudoStyleElement) {
          queueFullRescan();
        }

        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
          }

          if (isStylesheetNode(node)) {
            handleAddedStylesheet(node);
            return;
          }
          node.querySelectorAll('style, link').forEach(function(child) {
            if (isStylesheetNode(child)) {
              handleAddedStylesheet(child);
            }
          });

          if (node.nodeName === 'IMG') {
            checkAndReplaceImage(node);
          } else {
            node.querySelectorAll('img').forEach(checkAndReplaceImage);
          }

          queueBackgroundCheck(node);
          node.querySelectorAll('*').forEach(queueBackgroundCheck);
        });

        if (mutation.removedNodes.length > 0) {
          queuePseudoSweep();
        }

        // Removing a stylesheet can expose a lower-priority rule with a
        // broken background on elements that already exist
        mutation.removedNodes.forEach(function(node) {
          if (node.nodeType !== Node.ELEMENT_NODE || node === pseudoStyleElement) {
            return;
          }
          if (isStylesheetNode(node) ||
              Array.prototype.some.call(node.querySelectorAll('style, link'), isStylesheetNode)) {
            queueFullRescan();
          }
        });
      });
    });

    // Rooted at <html> so its own class/style changes and stylesheets added
    // to <head> are seen too
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'rel', 'href']
    });
  }

  function init() {
    checkExistingImages();
    checkExistingBackgrounds();
    observeChanges();

    // Stylesheets loaded late (async/preload tricks) can add backgrounds
    // after DOMContentLoaded; probes are cached, so a rescan is cheap
    if (document.readyState !== 'complete') {
      window.addEventListener('load', checkExistingBackgrounds);
    }
  }

  // Run after DOM content is fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
