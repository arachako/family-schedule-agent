window.APP_CONFIG = {
  // Safe to expose in a browser app. This is an OAuth client ID, not a client secret.
  googleClientId: "455904128632-c8ukc1gqrtelqcpuogi9vte4b1uiqifi.apps.googleusercontent.com"
};

// Add a true "Tomorrow" option without changing the read-only Calendar integration.
// The page's existing loader builds a generic time window, so when Tomorrow is
// selected we narrow Google Calendar event requests to tomorrow 00:00-24:00.
(function installTomorrowRange() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(input, init) {
    try {
      const sourceUrl = typeof input === "string" ? input : input?.url;
      const url = new URL(sourceUrl, window.location.href);
      const daysSelect = document.getElementById("days");
      const isCalendarEventsRequest =
        url.hostname === "www.googleapis.com" &&
        url.pathname.includes("/calendar/v3/calendars/") &&
        url.pathname.endsWith("/events");

      if (isCalendarEventsRequest && daysSelect?.value === "tomorrow") {
        const start = new Date();
        start.setDate(start.getDate() + 1);
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        url.searchParams.set("timeMin", start.toISOString());
        url.searchParams.set("timeMax", end.toISOString());

        if (typeof input === "string") {
          input = url.toString();
        } else if (input instanceof Request) {
          input = new Request(url.toString(), input);
        }
      }
    } catch {
      // If URL inspection fails, preserve the original request.
    }

    return originalFetch(input, init);
  };

  window.addEventListener("DOMContentLoaded", () => {
    const daysSelect = document.getElementById("days");
    if (!daysSelect || daysSelect.querySelector('option[value="tomorrow"]')) return;

    const option = document.createElement("option");
    option.value = "tomorrow";
    option.textContent = "Tomorrow";

    const nextThreeDays = [...daysSelect.options].find(o => o.value === "3");
    daysSelect.insertBefore(option, nextThreeDays || null);
  });
})();
