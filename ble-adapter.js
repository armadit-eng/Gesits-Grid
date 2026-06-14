/**
 * BLE Adapter v3
 * Capacitor mode: pakai window.BluetoothLe (di-expose via bridge)
 * PWA mode: pakai Web Bluetooth API
 */

const BLEAdapter = (() => {

  const isCapacitor = !!(window.Capacitor?.isNativePlatform?.());
  const isWebBluetooth = !isCapacitor && !!navigator.bluetooth;

  // ─── CAPACITOR ───
  class CapacitorBLE {
    constructor() {
      this.ble = null;
      this.deviceId = null;
      this.deviceName = null;
    }

    async initialize() {
      // Di v6, BleClient di-expose via Capacitor bridge sebagai:
      // window.Capacitor.Plugins.BluetoothLe
      // Tapi method-nya dipanggil langsung, initialize() harus via Capacitor action

      // Coba semua kemungkinan cara akses
      const cap = window.Capacitor;
      this.ble = cap?.Plugins?.BluetoothLe;

      if (!this.ble) {
        throw new Error('Plugin BluetoothLe tidak ditemukan. Pastikan APK sudah di-rebuild dengan plugin terbaru.');
      }

      // initialize() di v6 menggunakan Capacitor.nativeCallback pattern
      // Panggil via plugin proxy
      try {
        await this.ble.initialize();
        console.log('[BLE] initialized OK');
      } catch(e) {
        // Beberapa versi throw jika sudah initialized, ignore
        console.warn('[BLE] initialize warning:', e.message);
      }
    }

    async requestDevice() {
      const found = new Map();

      // Request permission dulu (Android 12+)
      try {
        const perm = await this.ble.requestPermissions();
        console.log('[BLE] permissions:', JSON.stringify(perm));
      } catch(e) {
        console.warn('[BLE] permission req:', e.message);
      }

      return new Promise(async (resolve, reject) => {
        // Mulai scan
        try {
          await this.ble.requestLEScan({ allowDuplicates: false });
        } catch(e) {
          reject(new Error('Scan gagal: ' + e.message));
          return;
        }

        const listener = await this.ble.addListener('onScanResult', (r) => {
          const id = r?.device?.deviceId;
          if (id && !found.has(id)) {
            found.set(id, {
              deviceId: id,
              name: r?.device?.name || r?.advertisementData?.localName || id
            });
          }
        });

        setTimeout(async () => {
          try { listener?.remove?.(); } catch(e) {}
          try { await this.ble.stopLEScan(); } catch(e) {}
          resolve({ devices: Array.from(found.values()), _isCapacitor: true });
        }, 5000);
      });
    }

    async connect(deviceId, name) {
      this.deviceId = deviceId;
      this.deviceName = name || deviceId;
      await this.ble.connect({ deviceId });
      console.log('[BLE] connected:', deviceId);
    }

    async startNotify(serviceUUID, charUUID, callback) {
      // Normalize UUID ke lowercase
      const svc = serviceUUID.toLowerCase();
      const chr = charUUID.toLowerCase();

      try {
        await this.ble.startNotifications({
          deviceId: this.deviceId,
          service: svc,
          characteristic: chr,
        });
        console.log('[BLE] startNotifications OK');
      } catch(e) {
        throw new Error('startNotifications gagal: ' + e.message);
      }

      // v6 plugin event name: 'BleClientOnValueChanged' + deviceId + service + char
      // Coba beberapa kemungkinan event name
      const eventNames = [
        'onBleValueChanged',
        'BleClientOnValueChanged',
        `notification|${this.deviceId}|${svc}|${chr}`,
        `notification|${this.deviceId}|${svc.replace(/-/g,'')}|${chr.replace(/-/g,'')}`,
      ];

      let listenerAdded = false;
      for (const evName of eventNames) {
        try {
          await this.ble.addListener(evName, (result) => {
            if (!result) return;
            try {
              let text = '';
              const val = result.value;
              if (typeof val === 'string') {
                try { text = atob(val); } catch(e) { text = val; }
              } else if (val?.buffer) {
                text = new TextDecoder().decode(val);
              } else if (Array.isArray(val)) {
                text = new TextDecoder().decode(new Uint8Array(val));
              } else if (val?.data) {
                // beberapa versi wrap di {data: [...]}
                text = new TextDecoder().decode(new Uint8Array(val.data));
              }
              if (text) callback(text);
            } catch(e) {
              console.warn('[BLE] decode:', e);
            }
          });
          console.log('[BLE] listener registered:', evName);
          listenerAdded = true;
          break;
        } catch(e) {
          console.warn('[BLE] listener', evName, 'failed:', e.message);
        }
      }

      if (!listenerAdded) {
        console.warn('[BLE] No listener worked, trying generic addListener');
      }
    }

    async write(serviceUUID, charUUID, text) {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      try {
        await this.ble.write({ deviceId: this.deviceId, service: serviceUUID, characteristic: charUUID, value: b64 });
      } catch(e) {
        await this.ble.writeWithoutResponse({ deviceId: this.deviceId, service: serviceUUID, characteristic: charUUID, value: b64 });
      }
    }

    async disconnect() {
      try { await this.ble.disconnect({ deviceId: this.deviceId }); } catch(e) {}
      this.deviceId = null;
    }

    onDisconnect(callback) {
      this.ble?.addListener('onDisconnected', callback);
    }

    getDeviceName() { return this.deviceName || this.deviceId || 'GESITS'; }
  }

  // ─── WEB BLUETOOTH ───
  class WebBLE {
    constructor() { this.device = null; this.char = null; }

    async initialize() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth tidak didukung');
    }

    async requestDevice() {
      const uuids = [
        '0000fff0-0000-1000-8000-00805f9b34fb','0000fff1-0000-1000-8000-00805f9b34fb',
        '0000fff2-0000-1000-8000-00805f9b34fb','0000ffe0-0000-1000-8000-00805f9b34fb',
        '0000ffe1-0000-1000-8000-00805f9b34fb','6e400001-b5a3-f393-e0a9-e50e24dcca9e',
        '6e400002-b5a3-f393-e0a9-e50e24dcca9e','6e400003-b5a3-f393-e0a9-e50e24dcca9e',
      ];
      this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: uuids });
      return { device: this.device, _isCapacitor: false };
    }

    async connect(deviceOrId, serviceUUID, charUUID) {
      if (typeof deviceOrId === 'object') this.device = deviceOrId;
      const server  = await this.device.gatt.connect();
      const service = await server.getPrimaryService(serviceUUID);
      this.char     = await service.getCharacteristic(charUUID);
    }

    async startNotify(serviceUUID, charUUID, callback) {
      await this.char.startNotifications();
      this.char.addEventListener('characteristicvaluechanged', (e) => {
        callback(new TextDecoder().decode(e.target.value));
      });
    }

    async write(serviceUUID, charUUID, text) {
      const enc = new TextEncoder().encode(text);
      try { await this.char.writeValue(enc); }
      catch(e) { await this.char.writeValueWithoutResponse(enc); }
    }

    async disconnect() {
      if (this.device?.gatt.connected) this.device.gatt.disconnect();
      this.char = null;
    }

    onDisconnect(callback) { this.device?.addEventListener('gattserverdisconnected', callback); }
    getDeviceName() { return this.device?.name || 'Unknown'; }
  }

  // ─── FACTORY ───
  async function create() {
    if (isCapacitor) {
      console.log('[BLE] Capacitor mode');
      const a = new CapacitorBLE();
      await a.initialize();
      return a;
    } else if (isWebBluetooth) {
      console.log('[BLE] Web Bluetooth mode');
      const a = new WebBLE();
      await a.initialize();
      return a;
    } else {
      throw new Error('BLE tidak didukung di environment ini');
    }
  }

  return { create, isCapacitor, isWebBluetooth };
})();
