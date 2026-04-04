(function () {
  'use strict';

  var PROFILE_S25_ULTRA_ONEUI_WEBAPK = 's25-ultra-oneui-webapk';
  var PROFILE_ANDROID_UNKNOWN = 'android-unknown';
  var PROFILE_GENERIC_UNKNOWN = 'generic-unknown';
  var LS_DEVICE_PROFILE_OVERRIDE = 'bp_device_profile_id';

  // Temporary deployment policy for this phase:
  // default to S25 Ultra profile until multi-device tuning is in place.
  // Future menu-based override should write LS_DEVICE_PROFILE_OVERRIDE and
  // remain higher priority than auto-detection logic.
  var FORCED_PROFILE_DEFAULT = PROFILE_S25_ULTRA_ONEUI_WEBAPK;

  var VALID_PROFILE_IDS = Object.create(null);
  VALID_PROFILE_IDS[PROFILE_S25_ULTRA_ONEUI_WEBAPK] = true;
  VALID_PROFILE_IDS[PROFILE_ANDROID_UNKNOWN] = true;
  VALID_PROFILE_IDS[PROFILE_GENERIC_UNKNOWN] = true;

  function isValidProfileId(profileId) {
    return !!VALID_PROFILE_IDS[profileId];
  }

  function detectProfileId() {
    var ua = (navigator.userAgent || '').toLowerCase();
    if (ua.indexOf('android') !== -1) {
      return PROFILE_ANDROID_UNKNOWN;
    }
    return PROFILE_GENERIC_UNKNOWN;
  }

  function readStoredOverride() {
    try {
      var value = localStorage.getItem(LS_DEVICE_PROFILE_OVERRIDE);
      if (isValidProfileId(value)) return value;
    } catch (_) {}
    return null;
  }

  function resolveProfile() {
    // Planned precedence model:
    // 1) explicit user override (future menu)
    // 2) temporary forced default (current deployment)
    // 3) lightweight runtime detection fallback
    var stored = readStoredOverride();
    if (stored) {
      return { id: stored, source: 'user-override' };
    }
    if (isValidProfileId(FORCED_PROFILE_DEFAULT)) {
      return { id: FORCED_PROFILE_DEFAULT, source: 'forced-default' };
    }
    return { id: detectProfileId(), source: 'detected' };
  }

  function applyProfileAttributes(profileId, source) {
    var root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-device-profile', profileId);
    root.setAttribute('data-device-profile-source', source);
    if (document.body) {
      document.body.setAttribute('data-device-profile', profileId);
      document.body.setAttribute('data-device-profile-source', source);
    }
  }

  var resolved = resolveProfile();
  applyProfileAttributes(resolved.id, resolved.source);
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () {
      applyProfileAttributes(resolved.id, resolved.source);
    });
  }

  // Keep this API stable so future Settings menu controls can switch profile
  // without reworking all profile-aware CSS/JS callsites.
  window.BlueprintsDeviceProfile = {
    PROFILE_S25_ULTRA_ONEUI_WEBAPK: PROFILE_S25_ULTRA_ONEUI_WEBAPK,
    PROFILE_ANDROID_UNKNOWN: PROFILE_ANDROID_UNKNOWN,
    PROFILE_GENERIC_UNKNOWN: PROFILE_GENERIC_UNKNOWN,
    LS_DEVICE_PROFILE_OVERRIDE: LS_DEVICE_PROFILE_OVERRIDE,
    profileId: resolved.id,
    source: resolved.source,
    detectProfileId: detectProfileId,
    isValidProfileId: isValidProfileId,
    setOverride: function (profileId) {
      if (!isValidProfileId(profileId)) return false;
      try {
        localStorage.setItem(LS_DEVICE_PROFILE_OVERRIDE, profileId);
      } catch (_) {
        return false;
      }
      return true;
    },
    clearOverride: function () {
      try {
        localStorage.removeItem(LS_DEVICE_PROFILE_OVERRIDE);
        return true;
      } catch (_) {
        return false;
      }
    }
  };
})();
