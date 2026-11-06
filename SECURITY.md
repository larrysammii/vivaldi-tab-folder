# Security

This is an experimental privileged browser-UI mod. It can read and operate live tabs in the profile where it runs. Review the source before loading it; do not treat a UI mod as a security boundary.

## Report safely

Use GitHub's private vulnerability reporting if it is available for this repository. Otherwise open a minimal issue requesting a private reporting channel **without publishing exploit details or sensitive data**. A private reporting service or guaranteed response time is not promised.

Never attach browsing profiles, cookies, passwords, raw CDP/console logs, HARs, account information, or private URLs. Use a disposable profile and synthetic content for a reproduction.

## Installation risks

Persistent installation changes signed Vivaldi app resources. It invalidates the vendor resource seal and can cause macOS to block launch. The tooling does not re-sign apps, remove quarantine, disable security checks, or alter the executable. Restore the pristine app rather than weakening OS protections.

The trial opens loopback debugging for a separate `.local/test-profile`; other local processes may be able to attach. Do not use that profile for sensitive browsing or Sync. Quitting its browser process ends the debugging session.

The mod does not provide network services, analytics, or remote assets. Folder storage does not include browsing URLs or tab titles. Private windows are excluded. Internal browser APIs are version-sensitive; only the documented build has been checked.
