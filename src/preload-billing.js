'use strict';

// The billing dashboard's "Laptop mode" hides the user email / balance pill in
// the navbar. Seed it before the page scripts run so it is enabled for fresh
// sessions, while still respecting a choice made later through the site itself.
try {
  if (window.localStorage.getItem('laptopMode') === null) {
    window.localStorage.setItem('laptopMode', 'true');
  }
} catch {
  /* storage can be unavailable before the document has a usable origin */
}
