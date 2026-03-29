import 'package:shared_preferences/shared_preferences.dart';

/// Configuración global del sistema (leída de /api/settings)
/// Se guarda en SharedPreferences para acceso offline.
class AppSettings {
  final bool igvEnabled;
  final double igvPercent;
  final bool mostrarImagenesApk;
  final bool permitirHistorialCliente;
  final bool permitirDescuentos;
  final int stockMinimoAlerta;
  final int geocercaRadioMetros;

  const AppSettings({
    this.igvEnabled = true,
    this.igvPercent = 18,
    this.mostrarImagenesApk = true,
    this.permitirHistorialCliente = false,
    this.permitirDescuentos = false,
    this.stockMinimoAlerta = 5,
    this.geocercaRadioMetros = 100,
  });

  factory AppSettings.fromMap(Map<String, dynamic> m) => AppSettings(
    igvEnabled: m['IGV_ENABLED'] == true || m['IGV_ENABLED'] == 'true',
    igvPercent: (m['IGV_PERCENT'] ?? 18).toDouble(),
    mostrarImagenesApk: m['MOSTRAR_IMAGENES_APK'] == true || m['MOSTRAR_IMAGENES_APK'] == 'true',
    permitirHistorialCliente: m['PERMITIR_HISTORIAL_CLIENTE'] == true || m['PERMITIR_HISTORIAL_CLIENTE'] == 'true',
    permitirDescuentos: m['PERMITIR_DESCUENTOS'] == true || m['PERMITIR_DESCUENTOS'] == 'true',
    stockMinimoAlerta: (m['STOCK_MINIMO_ALERTA'] ?? 5) is int ? m['STOCK_MINIMO_ALERTA'] : int.tryParse(m['STOCK_MINIMO_ALERTA'].toString()) ?? 5,
    geocercaRadioMetros: (m['GEOCERCA_RADIO_METROS'] ?? 100) is int ? m['GEOCERCA_RADIO_METROS'] : int.tryParse(m['GEOCERCA_RADIO_METROS'].toString()) ?? 100,
  );

  // ── Persistencia en SharedPreferences ────────────────────────────────────────

  static const _prefix = 'app_setting_';

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('${_prefix}igv_enabled', igvEnabled);
    await prefs.setDouble('${_prefix}igv_percent', igvPercent);
    await prefs.setBool('${_prefix}mostrar_imagenes', mostrarImagenesApk);
    await prefs.setBool('${_prefix}historial_cliente', permitirHistorialCliente);
    await prefs.setBool('${_prefix}descuentos', permitirDescuentos);
    await prefs.setInt('${_prefix}stock_alerta', stockMinimoAlerta);
    await prefs.setInt('${_prefix}geocerca_radio', geocercaRadioMetros);
  }

  static Future<AppSettings> load() async {
    final prefs = await SharedPreferences.getInstance();
    return AppSettings(
      igvEnabled: prefs.getBool('${_prefix}igv_enabled') ?? true,
      igvPercent: prefs.getDouble('${_prefix}igv_percent') ?? 18,
      mostrarImagenesApk: prefs.getBool('${_prefix}mostrar_imagenes') ?? true,
      permitirHistorialCliente: prefs.getBool('${_prefix}historial_cliente') ?? false,
      permitirDescuentos: prefs.getBool('${_prefix}descuentos') ?? false,
      stockMinimoAlerta: prefs.getInt('${_prefix}stock_alerta') ?? 5,
      geocercaRadioMetros: prefs.getInt('${_prefix}geocerca_radio') ?? 100,
    );
  }
}
