const MAX_EVENTS = 200;

const typeClass = {
  motion: "event-item--motion",
  hand: "event-item--hand",
  pose: "event-item--pose",
  system: "event-item--system",
};

/**
 * @param {HTMLElement} listEl
 * @param {HTMLElement} emptyEl
 */
export function createEventLog(listEl, emptyEl) {
  /**
   * @param {{ category: keyof typeClass, label: string, detail?: string }} event
   */
  function log(event) {
    const li = document.createElement("li");
    li.className = `event-item ${typeClass[event.category] ?? ""}`;

    const time = document.createElement("span");
    time.className = "event-item__time";
    time.textContent = formatTime(new Date());

    const label = document.createElement("span");
    label.className = `event-item__type event-item__type--${event.category}`;
    label.textContent = event.label;

    li.append(time, label);

    if (event.detail) {
      const detail = document.createElement("span");
      detail.className = "event-item__detail";
      detail.textContent = event.detail;
      li.append(detail);
    }

    listEl.prepend(li);

    while (listEl.children.length > MAX_EVENTS) {
      listEl.lastElementChild?.remove();
    }

    emptyEl.hidden = listEl.children.length > 0;

    console.log(`[camtrol:${event.category}]`, event.label, event.detail ?? "");
  }

  function clear() {
    listEl.replaceChildren();
    emptyEl.hidden = false;
  }

  return { log, clear };
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 1,
  });
}
