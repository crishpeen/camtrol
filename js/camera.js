/**
 * Camera stream + device list + mirror preview (CSS) synced with ML flipHorizontal.
 */

/**
 * @param {MediaDeviceInfo[]} devices
 */
export function videoInputDevices(devices) {
  return devices.filter((d) => d.kind === "videoinput");
}

/**
 * @param {MediaDeviceInfo} device
 */
export function cameraLabel(device) {
  if (device.label) return device.label;
  if (device.deviceId) return `Camera ${device.deviceId.slice(0, 8)}…`;
  return "Camera";
}

/**
 * @param {MediaStream} stream
 */
export function streamFacingMode(stream) {
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.();
  return settings?.facingMode ?? null;
}

/**
 * @param {HTMLElement} videoWrap
 * @param {boolean} mirrored
 */
export function applyMirrorToDom(videoWrap, mirrored) {
  videoWrap?.classList.toggle("video-wrap--mirror", mirrored);
}

/**
 * Default mirror off — preview matches “true” camera orientation; user can enable selfie mirror.
 * @param {string | null} _facingMode
 */
export function defaultMirrorForFacing(_facingMode) {
  return false;
}

/**
 * @param {{ deviceId?: string, facingMode?: string }} choice
 */
export function buildVideoConstraints(choice) {
  if (choice.deviceId) {
    return {
      deviceId: { exact: choice.deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
  }
  return {
    facingMode: choice.facingMode ?? "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
  };
}

/**
 * @param {{ deviceId?: string, facingMode?: string }} choice
 */
export async function openCameraStream(choice) {
  return navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(choice),
    audio: false,
  });
}

/**
 * @param {HTMLSelectElement | null} select
 * @param {MediaDeviceInfo[]} cameras
 * @param {string} [selectedId]
 */
export function fillCameraSelect(select, cameras, selectedId) {
  if (!select) return;
  select.replaceChildren();

  if (!cameras.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No camera found";
    select.append(opt);
    select.disabled = true;
    return;
  }

  for (const cam of cameras) {
    const opt = document.createElement("option");
    opt.value = cam.deviceId;
    opt.textContent = cameraLabel(cam);
    if (cam.deviceId === selectedId) opt.selected = true;
    select.append(opt);
  }

  select.disabled = cameras.length < 2;
}

/**
 * @param {string} [deviceId]
 */
export async function refreshCameraList(deviceId) {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: videoInputDevices(devices),
    selectedId: deviceId,
  };
}
