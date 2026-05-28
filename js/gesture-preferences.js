const STORAGE_KEY = "camtrol-gesture-prefs-v1";

/** @type {Record<string, { label: string, items: Record<string, string> }>} */
export const GESTURE_GROUPS = {
  hand_poses: {
    label: "Hand poses",
    items: {
      thumbs_up: "Thumbs up 👍",
      thumbs_down: "Thumbs down 👎",
      peace: "Peace ✌️",
      pointing: "Pointing 👉",
      open_palm: "Open palm ✋",
      fist: "Fist ✊",
      middle_finger: "Middle finger 🖕",
      rock_on: "Rock on 🤘",
      pinch: "Pinch 🤏",
    },
  },
  hand_motion: {
    label: "Hand motion",
    items: {
      wave: "Wave 👋",
      zoom_in: "Zoom in 🔍",
      zoom_out: "Zoom out 🔎",
    },
  },
  hand_tap: {
    label: "Tap & hold",
    items: {
      tap: "Tap",
      double_tap: "Double tap",
      long_press: "Long press",
    },
  },
  hand_swipe: {
    label: "Swipes",
    items: {
      swipe_left: "Swipe left",
      swipe_right: "Swipe right",
      swipe_up: "Swipe up",
      swipe_down: "Swipe down",
    },
  },
  hand_scroll: {
    label: "Scroll",
    items: {
      scroll_up: "Scroll up",
      scroll_down: "Scroll down",
    },
  },
  hand_drag: {
    label: "Drag",
    items: {
      drag_up: "Drag up",
      drag_down: "Drag down",
      drag_left: "Drag left",
      drag_right: "Drag right",
    },
  },
  hand_other: {
    label: "Other hand",
    items: {
      rotate: "Rotate (pinch twist)",
      hand_presence: "Hand detected (log)",
    },
  },
  face_expression: {
    label: "Face expressions",
    items: {
      smile: "Smile 😊",
      grin: "Grin 😁",
      frown: "Frown 😞",
      surprise: "Surprise 😮",
      jaw_drop: "Mouth open 😲",
      grimace: "Grimace 😬",
      squint: "Squint 😑",
      kiss: "Kiss 😗",
      brows_up: "Brows up 🤨",
      brows_down: "Brows furrowed 😠",
      face_presence: "Face detected (log)",
    },
  },
  face_gaze: {
    label: "Gaze zones",
    items: {
      gaze_center: "Center",
      gaze_left: "Left",
      gaze_right: "Right",
      gaze_top: "Up",
      gaze_bottom: "Down",
      "gaze_top-left": "Top-left",
      "gaze_top-right": "Top-right",
      "gaze_bottom-left": "Bottom-left",
      "gaze_bottom-right": "Bottom-right",
    },
  },
  pose: {
    label: "Body pose",
    items: {
      pose_body: "Body detected (log)",
      pose_limb: "Limb movement",
    },
  },
};

/** @type {Record<string, string>} */
const GESTURE_TO_GROUP = {};
for (const [groupId, group] of Object.entries(GESTURE_GROUPS)) {
  for (const gestureId of Object.keys(group.items)) {
    GESTURE_TO_GROUP[gestureId] = groupId;
  }
}

/** Gaze zone ids from detector → preference keys */
export function gazePrefKey(zoneId) {
  return `gaze_${zoneId}`;
}

function defaultEnabled(gestureId) {
  if (gestureId === "tap" || gestureId === "double_tap") return false;
  return true;
}

function loadPrefs() {
  /** @type {Record<string, boolean>} */
  const prefs = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(prefs, JSON.parse(raw));
  } catch {
    /* ignore */
  }
  for (const [groupId, group] of Object.entries(GESTURE_GROUPS)) {
    for (const gestureId of Object.keys(group.items)) {
      if (prefs[gestureId] === undefined) {
        prefs[gestureId] = defaultEnabled(gestureId);
      }
    }
  }
  return prefs;
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

/** @type {{ prefs: Record<string, boolean>, listeners: Set<() => void> } | null} */
let state = null;

export function getGesturePreferences() {
  if (!state) {
    state = { prefs: loadPrefs(), listeners: new Set() };
  }

  function notify() {
    for (const fn of state.listeners) fn();
  }

  return {
    isEnabled(gestureId) {
      return state.prefs[gestureId] !== false;
    },

    setEnabled(gestureId, enabled) {
      state.prefs[gestureId] = enabled;
      savePrefs(state.prefs);
      notify();
    },

    setGroupEnabled(groupId, enabled) {
      const group = GESTURE_GROUPS[groupId];
      if (!group) return;
      for (const gestureId of Object.keys(group.items)) {
        state.prefs[gestureId] = enabled;
      }
      savePrefs(state.prefs);
      notify();
    },

    isGroupEnabled(groupId) {
      const group = GESTURE_GROUPS[groupId];
      if (!group) return false;
      return Object.keys(group.items).every((id) => state.prefs[id] !== false);
    },

    isGroupPartial(groupId) {
      const group = GESTURE_GROUPS[groupId];
      if (!group) return false;
      const ids = Object.keys(group.items);
      const on = ids.filter((id) => state.prefs[id] !== false).length;
      return on > 0 && on < ids.length;
    },

    setAll(enabled) {
      for (const gestureId of Object.keys(state.prefs)) {
        state.prefs[gestureId] = enabled;
      }
      savePrefs(state.prefs);
      notify();
    },

    resetDefaults() {
      /** @type {Record<string, boolean>} */
      state.prefs = {};
      for (const group of Object.values(GESTURE_GROUPS)) {
        for (const gestureId of Object.keys(group.items)) {
          state.prefs[gestureId] = defaultEnabled(gestureId);
        }
      }
      savePrefs(state.prefs);
      notify();
    },

    subscribe(fn) {
      state.listeners.add(fn);
      return () => state.listeners.delete(fn);
    },

    /**
     * @param {HTMLElement} root
     */
    mountUI(root) {
      if (!root) return;
      const api = this;

      const render = () => {
        root.replaceChildren();

        for (const [groupId, group] of Object.entries(GESTURE_GROUPS)) {
          const section = document.createElement("div");
          section.className = "gesture-prefs__group";

          const head = document.createElement("div");
          head.className = "gesture-prefs__group-head";

          const groupToggle = document.createElement("label");
          groupToggle.className = "toggle gesture-prefs__group-toggle";
          const groupInput = document.createElement("input");
          groupInput.type = "checkbox";
          groupInput.checked = api.isGroupEnabled(groupId);
          groupInput.indeterminate = api.isGroupPartial(groupId);
          groupInput.addEventListener("change", () => {
            api.setGroupEnabled(groupId, groupInput.checked);
          });

          const groupTitle = document.createElement("span");
          groupTitle.textContent = group.label;

          groupToggle.append(groupInput, groupTitle);
          head.append(groupToggle);
          section.append(head);

          const list = document.createElement("ul");
          list.className = "gesture-prefs__list";

          for (const [gestureId, label] of Object.entries(group.items)) {
            const li = document.createElement("li");
            const labelEl = document.createElement("label");
            labelEl.className = "toggle gesture-prefs__item";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.checked = api.isEnabled(gestureId);
            input.addEventListener("change", () => {
              api.setEnabled(gestureId, input.checked);
            });
            const span = document.createElement("span");
            span.textContent = label;
            labelEl.append(input, span);
            li.append(labelEl);
            list.append(li);
          }

          section.append(list);
          root.append(section);
        }
      };

      render();
      api.subscribe(render);
    },
  };
}
