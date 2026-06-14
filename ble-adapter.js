/**
 * BLE Adapter — abstraksi untuk Web Bluetooth (PWA) dan Capacitor BLE (APK)
 * API yang sama, implementasi berbeda tergantung environment
 *
 * Usage:
 *   const ble = await BLEAdapter.create();
 *   await ble.requestDevice();
 *   await ble.connect(deviceId);
 *   await ble.startNotify(serviceUUID, charUUID, callback);
 *   await ble.write(serviceUUID, charUUID, data);
 *   await ble.disconnect();
 */

const BLEAdapter = (() => {

  // Deteksi environment
  const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const isWebBluetooth = !isCapacitor && !!navigator.bluetooth;

  // ─── CAPACITOR IMPLEMENTATION ───
  class CapacitorBLE {
    constructor(plugin) {
      this.ble = plugin;
      this.deviceId = null;
    }

    async initialize() {
      await this.ble.initialize();
      console.log('[BLE] Capacitor BLE initialized');
    }

    async requestDevice(namePrefix, serviceUUIDs) {
      return new Promise((resolve, reject) => {
        // Scan semua device, tampilkan list ke user
        const found = new Map();
        this.ble.requestLEScan({
          services: [],
          allowDuplicates: false,
        }).catch(() => {});

        this.ble.addListener('onScanResult', (result) => {
          if (!found.has(result.device.deviceId)) {
            found.set(result.device.deviceId, result.device);
          }
        });

        // Stop scan setelah 5 detik, tampilkan picker
        setTimeout(async () => {
          await this.ble.stopLEScan().catch(() => {});
          const devices = Array.from(found.values());
          if (devices.length === 0) { reject(new Error('Tidak ada perangkat BLE ditemukan')); return; }
          resolve({ devices, _isCapacitor: true });
        }, 5000);
      });
    }

    async connect(deviceId) {
      this.deviceId = deviceId;
      await this.ble.connect({ deviceId });
      console.log('[BLE] Connected to', deviceId);
    }

    async startNotify(serviceUUID, charUUID, callback) {
      await this.ble.startNotifications({
        deviceId: this.deviceId,
        service: serviceUUID,
        characteristic: charUUID,
      });
      await this.ble.addListener('onBleValueChanged', (result) => {
        if (result.characteristic.toLowerCase() === charUUID.toLowerCase()) {
          // result.value adalah base64
          const raw = atob(result.value);
          callback(raw);
        }
      });
    }

    async write(serviceUUID, charUUID, text) {
      // Encode string ke base64
      const b64 = btoa(text);
      try {
        await this.ble.write({
          deviceId: this.deviceId,
          service: serviceUUID,
          characteristic: charUUID,
          value: b64,
        });
      } catch(e) {
        // fallback writeWithoutResponse
        await this.ble.writeWithoutResponse({
          deviceId: this.deviceId,
          service: serviceUUID,
          characteristic: charUUID,
          value: b64,
        });
      }
    }

    async disconnect() {
      if (this.deviceId) {
        await this.ble.disconnect({ deviceId: this.deviceId }).catch(() => {});
        this.deviceId = null;
      }
    }

    onDisconnect(callback) {
      this.ble.addListener('onDisconnected', callback);
    }

    getDeviceName() { return this.deviceId; }
  }

  // ─── WEB BLUETOOTH IMPLEMENTATION ───
  class WebBLE {
    constructor() {
      this.device = null;
      this.char = null;
    }

    async initialize() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth tidak didukung');
      console.log('[BLE] Web Bluetooth ready');
    }

    async requestDevice(namePrefix, serviceUUIDs) {
      const allUUIDs = [...new Set([
        ...serviceUUIDs,
        '0000fff0-0000-1000-8000-00805f9b34fb',
        '0000fff1-0000-1000-8000-00805f9b34fb',
        '0000fff2-0000-1000-8000-00805f9b34fb',
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        '0000ffe1-0000-1000-8000-00805f9b34fb',
        '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
        '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
      ])];
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: allUUIDs,
      });
      return { device: this.device, _isCapacitor: false };
    }

    async connect(deviceOrId, serviceUUID, charUUID) {
      // deviceOrId = device object dari Web Bluetooth
      if (deviceOrId && typeof deviceOrId === 'object') this.device = deviceOrId;
      const server  = await this.device.gatt.connect();
      const service = await server.getPrimaryService(serviceUUID);
      this.char     = await service.getCharacteristic(charUUID);
      console.log('[BLE] Web Bluetooth connected:', this.device.name);
    }

    async startNotify(serviceUUID, charUUID, callback) {
      if (!this.char) throw new Error('Belum connect');
      await this.char.startNotifications();
      this.char.addEventListener('characteristicvaluechanged', (e) => {
        const text = new TextDecoder().decode(e.target.value);
        callback(text);
      });
    }

    async write(serviceUUID, charUUID, text) {
      if (!this.char) throw new Error('Belum connect');
      const enc = new TextEncoder().encode(text);
      try {
        await this.char.writeValue(enc);
      } catch(e) {
        await this.char.writeValueWithoutResponse(enc);
      }
    }

    async disconnect() {
      if (this.device?.gatt.connected) this.device.gatt.disconnect();
      this.char = null;
    }

    onDisconnect(callback) {
      this.device?.addEventListener('gattserverdisconnected', callback);
    }

    getDeviceName() { return this.device?.name || 'Unknown'; }
  }

  // ─── FACTORY ───
  async function create() {
    if (isCapacitor) {
      console.log('[BLE] Mode: Capacitor Native');
      const { BleClient } = window.CapacitorCommunityBluetoothLe;
      const adapter = new CapacitorBLE(BleClient);
      await adapter.initialize();
      return adapter;
    } else if (isWebBluetooth) {
      console.log('[BLE] Mode: Web Bluetooth');
      const adapter = new WebBLE();
      await adapter.initialize();
      return adapter;
    } else {
      throw new Error('BLE tidak didukung di environment ini');
    }
  }

  return { create, isCapacitor, isWebBluetooth };
})();
