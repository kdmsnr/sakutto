import { browser } from 'wxt/browser';

// Keep old onboarding links working after model setup moved to LM Studio settings.
window.location.replace(browser.runtime.getURL('/options.html'));
