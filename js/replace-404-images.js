(function() {
  'use strict';

  // URL of the placeholder image
  const PLACEHOLDER_IMAGE = 'https://ms18-web.github.io/public-placeholder/dummy.jpg';

  // Check whether an image is 404 and replace it
  function checkAndReplaceImage(img) {
    // Skip if it is already the placeholder
    if (img.src === PLACEHOLDER_IMAGE) {
      return;
    }

    // Save the original src
    const originalSrc = img.src;

    // Handle image load errors
    img.onerror = function() {
      console.warn('[404 Image Replacement] Failed to load image:', originalSrc);
      this.src = PLACEHOLDER_IMAGE;
      this.onerror = null; // Prevent infinite loop
    };

    // Check images that have already failed to load
    if (img.complete && img.naturalWidth === 0) {
      console.warn('[404 Image Replacement] Image already failed:', originalSrc);
      img.src = PLACEHOLDER_IMAGE;
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
