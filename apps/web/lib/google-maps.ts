let pending: Promise<any> | null = null;
let sequence = 0;
export async function loadGoogleMaps(key: string) {
  const w = window as any;
  if (w.google?.maps) return w.google.maps;
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const script = document.createElement("script"),
        callback = "projectConnectMapsReady" + ++sequence;
      const cleanup = (remove = false) => {
        clearTimeout(timeout);
        delete w[callback];
        script.onerror = null;
        if (remove) script.remove();
      };
      const fail = (message: string) => {
        cleanup(true);
        pending = null;
        reject(Error(message));
      };
      const timeout = setTimeout(
        () => fail("Google map timed out. Use list mode."),
        15000,
      );
      script.src =
        "https://maps.googleapis.com/maps/api/js?" +
        new URLSearchParams({ key, v: "weekly", loading: "async", callback });
      w[callback] = () => {
        if (!w.google?.maps)
          return fail("Google map returned invalid data. Use list mode.");
        cleanup();
        resolve(w.google.maps);
      };
      script.onerror = () => fail("Google map failed to load. Use list mode.");
      document.head.appendChild(script);
    });
  }
  return pending;
}
