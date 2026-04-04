(function () {
  "use strict";

  var ACTIVE_STORAGE = "local";
  var CLOUD_FAILED = false;

  function getTelegramWebApp() {
    return globalThis.Telegram && globalThis.Telegram.WebApp ? globalThis.Telegram.WebApp : null;
  }

  function detectTelegramWebApp() {
    return Boolean(getTelegramWebApp());
  }

  function getTelegramUserProfile() {
    var tg = getTelegramWebApp();
    var user = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
    if (!user) {
      return {
        id: null,
        firstName: "",
        lastName: "",
        fullName: "",
        username: "",
        avatarUrl: "",
        hasAvatar: false,
        isTelegram: false
      };
    }

    var firstName = user.first_name || "";
    var lastName = user.last_name || "";
    var fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

    return {
      id: user.id || null,
      firstName: firstName,
      lastName: lastName,
      fullName: fullName,
      username: user.username || "",
      avatarUrl: user.photo_url || "",
      hasAvatar: Boolean(user.photo_url),
      isTelegram: true
    };
  }

  function getLocalStorageAdapter() {
    return {
      type: "local",
      async getItem(key) {
        return localStorage.getItem(key);
      },
      async setItem(key, value) {
        localStorage.setItem(key, value);
      },
      async removeItem(key) {
        localStorage.removeItem(key);
      }
    };
  }

  function cloudCall(method, key, value) {
    return new Promise(function (resolve, reject) {
      try {
        var tg = getTelegramWebApp();
        var cloud = tg && tg.CloudStorage;
        if (!cloud || typeof cloud[method] !== "function") {
          reject(new Error("CloudStorage unavailable"));
          return;
        }

        var callback = function (error, result) {
          if (error) {
            reject(typeof error === "string" ? new Error(error) : error);
            return;
          }
          resolve(result);
        };

        if (method === "setItem") {
          cloud.setItem(key, value, callback);
          return;
        }
        cloud[method](key, callback);
      } catch (err) {
        reject(err);
      }
    });
  }

  function getCloudStorageAdapter() {
    return {
      type: "cloud",
      async getItem(key) {
        return cloudCall("getItem", key);
      },
      async setItem(key, value) {
        return cloudCall("setItem", key, value);
      },
      async removeItem(key) {
        return cloudCall("removeItem", key);
      }
    };
  }

  async function getAppStorage(options) {
    var local = getLocalStorageAdapter();
    var canUseCloud = detectTelegramWebApp() && Boolean(getTelegramWebApp().CloudStorage);
    if (!canUseCloud) {
      ACTIVE_STORAGE = "local";
      return makeSafeStorage(local, local);
    }

    var cloud = getCloudStorageAdapter();
    try {
      await cloud.getItem(options.storageKey);
      ACTIVE_STORAGE = "cloud";
      CLOUD_FAILED = false;
      return makeSafeStorage(cloud, local);
    } catch (error) {
      ACTIVE_STORAGE = "local";
      CLOUD_FAILED = true;
      return makeSafeStorage(local, local);
    }
  }

  function makeSafeStorage(primary, fallback) {
    return {
      get type() {
        return ACTIVE_STORAGE;
      },
      get cloudFailed() {
        return CLOUD_FAILED;
      },
      async getItem(key) {
        try {
          return await primary.getItem(key);
        } catch (error) {
          ACTIVE_STORAGE = "local";
          CLOUD_FAILED = true;
          return fallback.getItem(key);
        }
      },
      async setItem(key, value) {
        try {
          return await primary.setItem(key, value);
        } catch (error) {
          ACTIVE_STORAGE = "local";
          CLOUD_FAILED = true;
          return fallback.setItem(key, value);
        }
      },
      async removeItem(key) {
        try {
          return await primary.removeItem(key);
        } catch (error) {
          ACTIVE_STORAGE = "local";
          CLOUD_FAILED = true;
          return fallback.removeItem(key);
        }
      }
    };
  }

  globalThis.CourseAppPlatform = {
    detectTelegramWebApp: detectTelegramWebApp,
    getTelegramUserProfile: getTelegramUserProfile,
    getAppStorage: getAppStorage
  };
})();
