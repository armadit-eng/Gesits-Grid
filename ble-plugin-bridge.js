// BLE Plugin Bridge — expose Capacitor BluetoothLe plugin ke window
// Di-load setelah capacitor.js, sebelum ble-adapter.js
(function() {
  function exposePlugin() {
    var cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.BluetoothLe) {
      window.BluetoothLe = cap.Plugins.BluetoothLe;
      console.log('[Bridge] BluetoothLe ready via Capacitor.Plugins');
    } else {
      setTimeout(exposePlugin, 100);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', exposePlugin);
  } else {
    exposePlugin();
  }
})();
