let registrationPromise = null;

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  if (registrationPromise) {
    return registrationPromise;
  }

  registrationPromise = new Promise((resolve) => {
    const register = async () => {
      try {
        const swUrl = new URL("./sw.js", import.meta.url);
        const registration = await navigator.serviceWorker.register(swUrl);
        console.log("[PWA] Service worker registered:", registration.scope);
        resolve(registration);
      } catch (error) {
        console.warn("[PWA] Service worker registration failed:", error);
        resolve(null);
      }
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register, { once: true });
  });

  return registrationPromise;
}
