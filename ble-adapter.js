/**
 * BLE Adapter — abstraksi untuk Web Bluetooth (PWA) dan Capacitor BLE (APK)
 */

const BLEAdapter = (() => {

  const isCapacitor = !!(window.Capacitor?.isNativePlatform?.());
  const isWebBluetooth = !isCapacitor && !!navigator.bluetooth;

  // ─── CAPACITOR IMPLEMENTATION ───
  class CapacitorBLE {
    constructor() {
      this.plugin = null;
      this.deviceId = null;
      this.deviceName = null;
    }

    async initialize() {
      // Tunggu sampai Capacitor dan plugin siap
      await this._waitForPlugin();

      // Request runtime permissions Android 12+ sebelum apapun
      await this._requestPermissions();

      console.log('[BLE] Capacitor BLE initialized');
    }

    async _waitForPlugin() {
      return new Promise((resolve, reject) => {
        let tries = 0;
        const check = () => {
          const p = window.Capacitor?.Plugins?.BluetoothLe
                 || window.BluetoothLe
                 || window.CapacitorBluetoothLe?.BleClient;
          if (p) {
            this.plugin = p;
            resolve();
          } else if (++tries > 50) { // max 5 detik
            reject(new Error('Plugin BluetoothLe tidak ditemukan setelah 5 detik. Pastikan plugin ter-install dan APK di-rebuild.'));
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });
    }

    async _requestPermissions() {
      try {
        // Coba minta permission via plugin
        const result = await this.plugin.requestPermissions?.();
        console.log('[BLE] Permissions:', JSON.stringify(result));
      } catch(e) {
        console.warn('[BLE] requestPermissions skipped:', e.message);
      }
    }

    async requestDevice() {
      return new Promise(async (resolve, reject) => {
        const found = new Map();

        try {
          await this.plugin.requestLEScan({
            services: [],
            allowDuplicates: false,
          });
        } catch(e) {
          console.warn('[BLE] scan start error:', e.message);
          // Jika scan gagal, kemungkinan permission ditolak
          reject(new Error('Gagal scan BLE: ' + e.message + '. Pastikan izin Bluetooth sudah diberikan di Settings.'));
          return;
        }

        const listener = await this.plugin.addListener('onScanResult', (r) => {
          const id = r?.device?.deviceId;
          const name = r?.device?.name || r?.localName || '';
          if (id && !found.has(id)) {
            found.set(id, { deviceId: id, name });
          }
        });

        // Scan 5 detik
        setTimeout(async () => {
          try { listener?.remove?.(); } catch(e) {}
          try { await this.plugin.stopLEScan(); } catch(e) {}
          const devices = Array.from(found.values());
          resolve({ devices, _isCapacitor: true });
        }, 5000);
      });
    }

    async connect(deviceId, name) {
      this.deviceId = deviceId;
      this.deviceName = name || deviceId;
      try {
        await this.plugin.connect({ deviceId });
        console.log('[BLE] Connected:', deviceId);
      } catch(e) {
        throw new Error('Gagal connect ke ' + (name||deviceId) + ': ' + e.message);
      }
    }

    async startNotify(serviceUUID, charUUID, callback) {
      try {
        await this.plugin.startNotifications({
          deviceId: this.deviceId,
          service: serviceUUID,
          characteristic: charUUID,
        });
      } catch(e) {
        throw new Error('startNotifications gagal: ' + e.message + '. Cek UUID service/characteristic.');
      }

      await this.plugin.addListener('onBleValueChanged', (result) => {
        if (!result) return;
        // Plugin bisa return characteristic dalam berbagai format
        const chr = result.characteristic || result.uuid || '';
        if (chr && !chr.toLowerCase().includes(charUUID.replace(/-/g,'').slice(0,8).toLowerCase())) return;
        try {
          let text = '';
          if (typeof result.value === 'string') {
            // Base64
            try { text = atob(result.value); } catch(e) { text = result.value; }
          } else if (result.value?.buffer) {
            text = new TextDecoder().decode(result.value);
          } else if (Array.isArray(result.value)) {
            text = new TextDecoder().decode(new Uint8Array(result.value));
          }
          if (text) callback(text);
        } catch(e) {
          console.warn('[BLE] notify decode error:', e);
        }
      });
    }

    async write(serviceUUID, charUUID, text) {
      // Encode text ke base64
      const b64 = btoa(unescape(encodeURIComponent(text)));
      try {
        await this.plugin.write({
          deviceId: this.deviceId,
          service: serviceUUID,
          characteristic: charUUID,
          value: b64,
        });
      } catch(e) {
        // Fallback writeWithoutResponse
        try {
          await this.plugin.writeWithoutResponse({
            deviceId: this.deviceId,
            service: serviceUUID,
            characteristic: charUUID,
            value: b64,
          });
        } catch(e2) {
          console.warn('[BLE] write error:', e2.message);
        }
      }
    }

    async disconnect() {
      if (this.deviceId) {
        try { await this.plugin.disconnect({ deviceId: this.deviceId }); } catch(e) {}
        this.deviceId = null;
      }
    }

    onDisconnect(callback) {
      // Capacitor BLE fire 'onDisconnected' event
      this.plugin?.addListener('onDisconnected', (data) => {
        if (!data?.deviceId || data.deviceId === this.deviceId) callback(data);
      });
    }

    getDeviceName() { return this.deviceName || this.deviceId || 'GESITS'; }
  }

  // ─── WEB BLUETOOTH IMPLEMENTATION ───
  class WebBLE {
    constructor() { this.device = null; this.char = null; }

    async initialize() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth tidak didukung di browser ini');
    }

    async requestDevice() {
      const allUUIDs = [
        '0000fff0-0000-1000-8000-00805f9b34fb',
        '0000fff1-0000-1000-8000-00805f9b34fb',
        '0000fff2-0000-1000-8000-00805f9b34fb',
        '0000ffe0-0000-1000-8000-00805f9b34fb',
        '0000ffe1-0000-1000-8000-00805f9b34fb',
        '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
        '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
      ];
      this.device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: allUUIDs,
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
      console.log('[BLE] Mode: Web Bluetooth (PWA)');
      const adapter = new WebBLE();
      await adapter.initialize();
      return adapter;
    } else {
      throw new Error('BLE tidak didukung. Gunakan Chrome/Edge untuk PWA, atau install APK.');
    }
  }

  return { create, isCapacitor, isWebBluetooth };
})();
