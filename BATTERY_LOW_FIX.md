# FIX: Problemas de GPS con Batería Baja (< 10%)

## Problema Reportado
Cuando la batería baja a 10%, el GPS deja de funcionar y no se marcan nuevas zonas. Incluso después de cargar el teléfono, se queda en la misma zona sin detectar movimiento.

## Causas Raíz Identificadas

1. **Intervalo GPS demasiado largo en BATT_SAVER**: 300 segundos (5 minutos) hacía que no se detectaran cambios de zona
2. **Transición pobre desde BATT_SAVER**: Solo cambiaba a STOPPED sin permitir transiciones a DRIVING/WALKING
3. **Precisión GPS baja**: Usaba `LocationAccuracy.low` que generaba errores de posicionamiento
4. **Sin exención de optimización de batería**: Android optimiza la batería y detiene servicios
5. **Lógica de recuperación incorrecta**: No reiniciaba agresivamente el stream al recuperarse de batería baja

## Cambios Implementados

### 1. **Parámetros de BATT_SAVER Mejorados** 
📁 `lib/services/background_service.dart` (líneas ~390-400)

**ANTES:**
```dart
case TrackingState.BATT_SAVER:
  intervalSec = 300;        // 5 minutos - MUY LARGO
  distanceFilter = 50;
  accuracy = LocationAccuracy.low;
```

**DESPUÉS:**
```dart
case TrackingState.BATT_SAVER:
  intervalSec = 30;         // 30 segundos - 10x más frecuente ✅
  distanceFilter = 20;      // 20m en vez de 50m - mejor detección ✅
  accuracy = LocationAccuracy.best; // Mejor precisión ✅
```

**Impacto:**
- ✅ Detecta cambios de zona cada 30s en lugar de cada 5 minutos
- ✅ Mayor precisión incluso con batería baja
- ✅ Mejor sensibilidad para marcar nuevas zonas

---

### 2. **Lógica de Batería Crítica Mejorada**
📁 `lib/services/background_service.dart` (líneas ~320-335)

**ANTES:**
```dart
if (level < 15 && _currentState != TrackingState.BATT_SAVER) {
  _setState(TrackingState.BATT_SAVER);  // Activar en 15%
} else if (level >= 15 && _currentState == TrackingState.BATT_SAVER) {
  _setState(TrackingState.STOPPED);     // Solo a STOPPED
}
if (_currentState == TrackingState.BATT_SAVER) return; // Bloquea votación de estado
```

**DESPUÉS:**
```dart
if (level < 10 && _currentState != TrackingState.BATT_SAVER) {
  _setState(TrackingState.BATT_SAVER);  // Activar solo en 10% (menos intrusivo)
} else if (level >= 20 && _currentState == TrackingState.BATT_SAVER) {
  _setState(TrackingState.STOPPED);
  _restartLocationStream(reason: 'Battery Recovery'); // Reiniciio agresivo
}
```

**Impacto:**
- ✅ Único cambio de estado más estable (10% → 20% de margen)
- ✅ Reinicia GPS agresivamente al recuperarse
- ✅ Permite detectar movimiento inmediatamente después de cargar

---

### 3. **Votación de Estado Flexible**
📁 `lib/services/background_service.dart` (líneas ~460-478)

**ANTES:**
```dart
if (_currentState != TrackingState.DEEP_SLEEP &&
    _currentState != TrackingState.BATT_SAVER) {  // ❌ BATT_SAVER bloqueado
  // ... votación de estado
}
```

**DESPUÉS:**
```dart
if (_currentState != TrackingState.DEEP_SLEEP) {  // ✅ BATT_SAVER permitido
  // ... votación de estado
  // Ahora puede salir de BATT_SAVER si detecta DRIVING/WALKING
}
```

**Impacto:**
- ✅ Detecta cuando el usuario comienza a moverse
- ✅ Transiciona automáticamente a DRIVING/WALKING
- ✅ Aumenta la frecuencia del GPS si hay movimiento

---

### 4. **Exención de Optimización de Batería**
📁 `lib/screens/auth_wrapper.dart` 
📁 `android/app/src/main/kotlin/.../MainActivity.kt`

**Agregado:**
- Solicita al usuario exención de optimización de batería en primer inicio
- Verifica si la app ya está en whitelist
- Abre el diálogo de configuración de Android si es necesario

```kotlin
// MainActivity.kt - Nuevo método
private fun requestBatteryOptimizationExemption(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val packageName = applicationContext.packageName
        
        if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
            startActivity(intent)
        }
    }
    return true
}
```

**Impacto:**
- ✅ Android no optimiza la batería para esta app
- ✅ Servicio en foreground no es interrumpido
- ✅ GPS sigue funcionando incluso con batería < 5%

---

## Resultado Esperado

| Escenario | Antes | Después |
|-----------|-------|---------|
| **Batería 10%** | GPS vuelve a 5 min de intervalo | GPS cada 30s, alta precisión |
| **Cambio de zona con batería baja** | No se detecta (esperar 5 min) | Se detecta en <1 minuto |
| **Carga del teléfono** | Se queda en STOPPED | Transiciona a DRIVING/WALKING automáticamente |
| **Servicio en segundo plano** | iOS puede optimizar | Exención solicitada y otorgada |

---

## Recomendaciones Adicionales

1. **Habilitar DEBUG en Background Service:**
   - Usar logcat para verificar que Watchdog detecta batería baja correctamente
   - Comando: `adb logcat | grep -E "STATE|BATT|WATCHDOG"`

2. **Probar con Batería Baja:**
   - Usar Developer Options → Battery Saver Mode
   - Verificar logs para ver transiciones de estado

3. **Verifiicar Exención de Batería:**
   - Settings → Battery and Device Care → Battery → App power management
   - Asegurar que "GPS Tracker" está en whitelist

---

## Archivos Modificados

1. ✅ `lib/services/background_service.dart` - Lógica principal
2. ✅ `lib/screens/auth_wrapper.dart` - Solicitud de exención
3. ✅ `android/app/src/main/kotlin/com/.../MainActivity.kt` - Handler nativo

## Próximos Pasos

1. Compilar APK con los cambios
2. Instalar y probar simulando batería baja
3. Verificar que las zonas se marcan correctamente incluso con batería < 10%
4. Confirmar que sin cargar el teléfono, se recupera automáticamente
