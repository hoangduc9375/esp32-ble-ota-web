(function () {
  "use strict";

  const DEVICE_NAME = "esp32-lin-logger";
  const SERVICE_UUID = "7f1d0001-8e8f-4c4b-9d59-1a3d862df201";
  const CONTROL_UUID = "7f1d0002-8e8f-4c4b-9d59-1a3d862df201";
  const DATA_UUID = "7f1d0003-8e8f-4c4b-9d59-1a3d862df201";
  const STATUS_UUID = "7f1d0004-8e8f-4c4b-9d59-1a3d862df201";
  const CONTROL_FINISH = new Uint8Array([0x02]);
  const CONTROL_ABORT = new Uint8Array([0x03]);
  const FLASH_BLOCK_SIZE = 16 * 1024;

  const elements = {
    bluetoothStatus: document.querySelector("#bluetoothStatus"),
    fileStatus: document.querySelector("#fileStatus"),
    uploadStatus: document.querySelector("#uploadStatus"),
    connectButton: document.querySelector("#connectButton"),
    firmwareInput: document.querySelector("#firmwareInput"),
    fileDetails: document.querySelector("#fileDetails"),
    uploadButton: document.querySelector("#uploadButton"),
    abortButton: document.querySelector("#abortButton"),
    progressBar: document.querySelector("#progressBar"),
    progressText: document.querySelector("#progressText"),
    byteProgress: document.querySelector("#byteProgress"),
    logOutput: document.querySelector("#logOutput"),
  };

  let device = null;
  let controlCharacteristic = null;
  let dataCharacteristic = null;
  let statusCharacteristic = null;
  let selectedFile = null;
  let uploading = false;
  let abortRequested = false;
  let ignoreNoUpdateUntil = 0;
  const statusQueue = [];
  const textDecoder = new TextDecoder();

  function setStatus(element, text, state = "idle") {
    element.textContent = text;
    element.dataset.state = state;
  }

  function log(message) {
    const timestamp = new Date().toLocaleTimeString("vi-VN", { hour12: false });
    if (elements.logOutput.textContent === "Đang chờ thao tác…") {
      elements.logOutput.textContent = "";
    }
    elements.logOutput.textContent += `[${timestamp}] ${message}\n`;
    elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }

  function updateProgress(sent, total) {
    const percent = total === 0 ? 0 : Math.floor((sent * 100) / total);
    elements.progressBar.value = percent;
    elements.progressText.textContent = `${percent}%`;
    elements.byteProgress.textContent = `${sent.toLocaleString()} / ${total.toLocaleString()} bytes`;
  }

  function refreshButtons() {
    const connected = Boolean(device?.gatt?.connected);
    elements.connectButton.disabled = uploading;
    elements.firmwareInput.disabled = uploading;
    elements.uploadButton.disabled = !connected || !selectedFile || uploading;
    elements.abortButton.disabled = !uploading;
  }

  function onDisconnected() {
    controlCharacteristic = null;
    dataCharacteristic = null;
    statusCharacteristic = null;
    setStatus(elements.bluetoothStatus, "Đã ngắt kết nối", "error");
    if (uploading && !abortRequested) {
      setStatus(elements.uploadStatus, "Mất kết nối", "error");
      log("Mất kết nối trong khi upload; ESP32 sẽ hủy bản cập nhật chưa hoàn tất.");
    }
    refreshButtons();
  }

  function onStatusNotification(event) {
    const value = event.target.value;
    const message = textDecoder.decode(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
    if (message === "ERR NOUPDATE" && Date.now() < ignoreNoUpdateUntil) {
      log(`ESP32: ${message} (phản hồi dò kích thước gói)`);
      return;
    }
    statusQueue.push(message);
    log(`ESP32: ${message}`);
  }

  async function waitForStatus(prefixes, timeoutMilliseconds) {
    const deadline = Date.now() + timeoutMilliseconds;
    while (Date.now() < deadline) {
      while (statusQueue.length > 0) {
        const message = statusQueue.shift();
        if (message.startsWith("ERR")) {
          throw new Error(`ESP32 từ chối update: ${message}`);
        }
        if (prefixes.some((prefix) => message.startsWith(prefix))) {
          return message;
        }
      }
      await delay(20);
    }
    throw new Error(`Timeout khi chờ ${prefixes.join(" hoặc ")}`);
  }

  async function writeWithResponse(characteristic, value) {
    if (characteristic.writeValueWithResponse) {
      await characteristic.writeValueWithResponse(value);
    } else {
      await characteristic.writeValue(value);
    }
  }

  async function writeWithoutResponse(characteristic, value) {
    if (characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(value);
    } else {
      await characteristic.writeValue(value);
    }
  }

  async function detectChunkSize() {
    for (const size of [512, 244, 128, 64, 20]) {
      try {
        ignoreNoUpdateUntil = Date.now() + 1000;
        await writeWithoutResponse(dataCharacteristic, new Uint8Array(size));
        await delay(120);
        statusQueue.length = 0;
        return size;
      } catch (error) {
        log(`Gói ${size} byte không được hỗ trợ; thử gói nhỏ hơn.`);
      }
    }
    throw new Error("Không tìm được kích thước gói BLE phù hợp");
  }

  async function connect() {
    if (!navigator.bluetooth) {
      throw new Error("Trình duyệt này không hỗ trợ Web Bluetooth. Hãy dùng Chrome Android.");
    }

    setStatus(elements.bluetoothStatus, "Đang tìm…", "busy");
    log(`Đang tìm ${DEVICE_NAME}…`);
    device = await navigator.bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }],
      optionalServices: [SERVICE_UUID],
    });
    device.addEventListener("gattserverdisconnected", onDisconnected);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    [controlCharacteristic, dataCharacteristic, statusCharacteristic] =
      await Promise.all([
        service.getCharacteristic(CONTROL_UUID),
        service.getCharacteristic(DATA_UUID),
        service.getCharacteristic(STATUS_UUID),
      ]);
    await statusCharacteristic.startNotifications();
    statusCharacteristic.addEventListener(
      "characteristicvaluechanged",
      onStatusNotification,
    );

    setStatus(elements.bluetoothStatus, device.name || DEVICE_NAME, "ok");
    log("Đã kết nối và đăng ký nhận trạng thái OTA.");
    refreshButtons();
  }

  function buildBeginCommand(size, digest) {
    const command = new Uint8Array(20);
    new DataView(command.buffer).setUint32(0, size, true);
    command.set(digest, 4);
    return command;
  }

  async function sendAbort() {
    abortRequested = true;
    if (device?.gatt?.connected && controlCharacteristic) {
      try {
        await writeWithResponse(controlCharacteristic, CONTROL_ABORT);
      } catch (error) {
        log(`Không gửi được lệnh hủy: ${error.message}`);
      }
    }
  }

  async function upload() {
    if (!selectedFile || !device?.gatt?.connected) return;

    uploading = true;
    abortRequested = false;
    statusQueue.length = 0;
    refreshButtons();
    updateProgress(0, selectedFile.size);
    setStatus(elements.uploadStatus, "Đang chuẩn bị…", "busy");

    try {
      const image = new Uint8Array(await selectedFile.arrayBuffer());
      if (image.length === 0) throw new Error("Firmware rỗng");

      log(`Đang tính MD5 cho ${formatBytes(image.length)}…`);
      const digest = window.md5Bytes(image.buffer);
      const md5Hex = [...digest]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");

      const chunkSize = await detectChunkSize();
      log(`MD5 ${md5Hex}; kích thước gói BLE ${chunkSize} byte.`);
      await writeWithResponse(
        controlCharacteristic,
        buildBeginCommand(image.length, digest),
      );
      const ready = await waitForStatus(["READY"], 15000);
      log(ready);

      setStatus(elements.uploadStatus, "Đang upload", "busy");
      let sent = 0;
      while (sent < image.length) {
        if (abortRequested) throw new Error("Upload đã được hủy");

        const blockEnd = Math.min(sent + FLASH_BLOCK_SIZE, image.length);
        while (sent < blockEnd) {
          if (abortRequested) throw new Error("Upload đã được hủy");
          const chunkEnd = Math.min(sent + chunkSize, blockEnd);
          await writeWithoutResponse(
            dataCharacteristic,
            image.subarray(sent, chunkEnd),
          );
          sent = chunkEnd;
        }

        const progress = await waitForStatus(["PROGRESS"], 20000);
        const received = Number(progress.split(" ")[1]);
        if (!Number.isFinite(received) || received < sent) {
          throw new Error(`ACK không hợp lệ: ${progress}`);
        }
        updateProgress(sent, image.length);
      }

      setStatus(elements.uploadStatus, "Đang xác minh…", "busy");
      await writeWithResponse(controlCharacteristic, CONTROL_FINISH);
      await waitForStatus(["SUCCESS"], 30000);
      updateProgress(image.length, image.length);
      setStatus(elements.uploadStatus, "Thành công — đang reboot", "ok");
      log("Firmware đã được xác minh. ESP32 đang reboot.");
    } catch (error) {
      if (!abortRequested) await sendAbort();
      setStatus(elements.uploadStatus, "Thất bại", "error");
      log(`LỖI: ${error.message}`);
    } finally {
      uploading = false;
      refreshButtons();
    }
  }

  elements.connectButton.addEventListener("click", async () => {
    try {
      await connect();
    } catch (error) {
      setStatus(elements.bluetoothStatus, "Không kết nối được", "error");
      log(`LỖI KẾT NỐI: ${error.message}`);
      refreshButtons();
    }
  });

  elements.firmwareInput.addEventListener("change", () => {
    selectedFile = elements.firmwareInput.files[0] || null;
    if (!selectedFile) {
      setStatus(elements.fileStatus, "Chưa chọn file");
      elements.fileDetails.textContent = "Chỉ dùng file được build cho board này";
    } else if (!selectedFile.name.toLowerCase().endsWith(".bin")) {
      selectedFile = null;
      elements.firmwareInput.value = "";
      setStatus(elements.fileStatus, "Sai định dạng", "error");
      elements.fileDetails.textContent = "File phải có đuôi .bin";
    } else {
      setStatus(elements.fileStatus, selectedFile.name, "ok");
      elements.fileDetails.textContent = formatBytes(selectedFile.size);
      log(`Đã chọn ${selectedFile.name} (${formatBytes(selectedFile.size)}).`);
    }
    refreshButtons();
  });

  elements.uploadButton.addEventListener("click", upload);
  elements.abortButton.addEventListener("click", sendAbort);

  if (!navigator.bluetooth) {
    setStatus(elements.bluetoothStatus, "Không được hỗ trợ", "error");
    elements.connectButton.disabled = true;
    log("Web Bluetooth không khả dụng. Hãy mở trang bằng Chrome trên Android.");
  }
  refreshButtons();
})();
