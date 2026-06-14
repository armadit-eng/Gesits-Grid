/**
 * BLE Adapter — abstraksi untuk Web Bluetooth (PWA) dan Capacitor BLE (APK)
 */

const BLEAdapter = (() => {

  const isCapacitor = !!(window.Capacitor?.isNativePlatform?.());
  const isWebBluetooth = !isCapacitor && !!navigator.bluetooth;

  // ─── CAPACITOR: akses plugin via registerPlugin ───
  // Capacitor 5+ cara yang benar: Capacitor.registerPlugin
  function getCapacitorBLEPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;

    // Coba via registerPlugin (Capacitor 5 cara resmi)
    if (cap.registerPlugin) {
      return cap.registerPlugin('BluetoothLe', {
        android: () => import('./node_modules/@capacitor-community/bluetooth-le/dist/esm/index.js')
          .then(m => m.BleClient).catch(() => null),
      });
    }
    // Fallback: Plugins registry
    return cap.Plugins?.BluetoothLe || null;
  }

  // ─── CAPACITOR IMPLEMENTATION ───
  class CapacitorBLE {
    constructor() {
      this.plugin = null;
      this.deviceId = null;
      this.deviceName = null;
      this._disconnectListeners = [];
    }

    async initialize() {
      // Import BleClient langsung dari module yang sudah di-install
      // Capacitor sync akan bundle ini ke assets
      try {
        // Coba akses via Capacitor global yang di-inject saat build
        const p = window.Capacitor?.Plugins?.BluetoothLe;
        if (p) { this.plugin = p; }
        else throw new Error('fallback');
      } catch(e) {
        // Fallback: coba via window global yang mungkin di-expose plugin
        const p2 = window.BluetoothLe || window.CapacitorBluetoothLe;
        if (p2) { this.plugin = p2; }
        else throw new Error('BluetoothLe plugin tidak tersedia. Coba rebuild APK.');
      }
      await this.plugin.initialize();
      console.log('[BLE] Capacitor BLE initialized');
    }

    async requestDevice(namePrefix, serviceUUIDs) {
      return new Promise(async (resolve, reject) => {
        const found = new Map();
        try {
          await this.plugin.requestLEScan({ services: [], allowDuplicates: false });
        } catch(e) { console.warn('scan start:', e); }

        const listener = await this.plugin.addListener('onScanResult', (r) => {
          const id = r?.device?.deviceId;
          if (id && !found.has(id)) found.set(id, r.device);
        });

        setTimeout(async () => {
          listener?.remove?.();
          try { await this.plugin.stopLEScan(); } catch(e) {}
          resolve({ devices: Array.from(found.values()), _isCapacitor: true });
        }, 5000);
      });
    }

    async connect(deviceId) {
      this.deviceId = deviceId;
      await this.plugin.connect({ deviceId });
      console.log('[BLE] Connected:', deviceId);
    }

    async startNotify(serviceUUID, charUUID, callback) {
      await this.plugin.startNotifications({
        deviceId: this.deviceId,
        service: serviceUUID,
        characteristic: charUUID,
      });
      await this.plugin.addListener('onBleValueChanged', (result) => {
        if (!result?.characteristic) return;
        if (result.characteristic.toLowerCase() !== charUUID.toLowerCase()) return;
        try {
          // Capacitor BLE returns DataView or base64
          let text = '';
          if (typeof result.value === 'string') {
            text = atob(result.value); // base64
          } else if (result.value?.buffer) {
            text = new TextDecoder().decode(result.value); // DataView
          }
          if (text) callback(text);
        } catch(e) { console.warn('notify decode:', e); }
      });
    }

    async write(serviceUUID, charUUID, text) {
      // Encode ke base64
      const b64 = btoa(unescape(encodeURIComponent(text)));
      try {
        await this.plugin.write({
          deviceId: this.deviceId,
          service: serviceUUID,
          characteristic: charUUID,
          value: b64,
        });
      } catch(e) {
        await this.plugin.writeWithoutResponse({
          deviceId: this.deviceId,
          service: serviceUUID,
          characteristic: charUUID,
          value: b64,
        });
      }
    }

    async disconnect() {
      if (this.deviceId) {
        try { await this.plugin.disconnect({ deviceId: this.deviceId }); } catch(e) {}
        this.deviceId = null;
      }
    }

    onDisconnect(callback) {
      this.plugin?.addListener('onDisconnected', callback);
    }

    getDeviceName() { return this.deviceName || this.deviceId || 'GESITS'; }
  }

  // ─── WEB BLUETOOTH IMPLEMENTATION ───
  class WebBLE {
    constructor() { this.device = null; this.char = null; }

    async initialize() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth tidak didukung');
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
        acceptAllDevices: true, optionalServices: allUUIDs,
      });
      return { device: this.device, _isCapacitor: false };
    }

    async connect(deviceOrId, serviceUUID, charUUID) {
      if (deviceOrId && typeof deviceOrId === 'object') this.device = deviceOrId;
      const server  = await this.device.gatt.connect();
      const service = await server.getPrimaryService(serviceUUID);
      this.char     = await service.getCharacteristic(charUUID);
    }

    async startNotify(serviceUUID, charUUID, callback) {
      if (!this.char) throw new Error('Belum connect');
      await this.char.startNotifications();
      this.char.addEventListener('characteristicvaluechanged', (e) => {
        callback(new TextDecoder().decode(e.target.value));
      });
    }

    async write(serviceUUID, charUUID, text) {
      if (!this.char) throw new Error('Belum connect');
      const enc = new TextEncoder().encode(text);
      try { await this.char.writeValue(enc); }
      catch(e) { await this.char.writeValueWithoutResponse(enc); }
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
      console.log('[BLE] Mode: Capacitor Native Android');
      const adapter = new CapacitorBLE();
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
